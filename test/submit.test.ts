import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { base64url } from '../worker/lib/crypto'
import { call, json, mockFetch, publicKey, signIn } from './helpers'

const RAW = 'https://raw.githubusercontent.com'
const repo = { id: 77, full_name: 'octo-author/geoip', private: false, archived: false, default_branch: 'main', owner: { id: 4242, login: 'octo-author', type: 'User', avatar_url: '' }, license: { spdx_id: 'MIT' }, permissions: { admin: true, push: true, pull: true } }
const manifest = { id: 'io.github.octo-author.geoip', name: 'GeoIP Access', description: 'Allow or deny by country.', capabilities: ['security.blocklist'], i18n: { zh_CN: { name: 'GeoIP 访问控制' } } }
const release = { tag_name: 'v1.0.0', prerelease: false, draft: false, html_url: 'https://github.com/octo-author/geoip/releases/tag/v1.0.0', assets: [{ name: 'io.github.octo-author.geoip-1.0.0-linux-amd64.tar.gz' }] }

let dispatched: { change: string, payload: string }[] = []
let manifestBody: unknown = manifest

function github(): Route[] {
  return [
    url => url.href === `${env.CATALOG_URL}/v1/index.json` ? json({ plugins: [] }) : undefined,
    url => url.href === `${RAW}/${env.CATALOG_REPO}/main/blocked.json` ? json({ plugins: [], repositories: ['bad/repo'] }) : undefined,
    url => url.href === `${RAW}/${env.CATALOG_REPO}/main/schema/entry.schema.json` ? json({ $defs: { category: { enum: ['security', 'dns'] } } }) : undefined,
    url => url.href === 'https://api.github.com/repos/octo-author/geoip' ? json(repo) : undefined,
    url => url.href.startsWith('https://api.github.com/repos/octo-author/geoip/releases') ? json([release]) : undefined,
    url => url.href === `${RAW}/octo-author/geoip/v1.0.0/plugin.json` ? new Response(JSON.stringify(manifestBody)) : undefined,
    url => url.pathname === `/repos/${env.CATALOG_REPO}/installation` ? json({ id: 9 }) : undefined,
    url => url.pathname === '/app/installations/9/access_tokens' ? json({ token: 'ghs_actions' }) : undefined,
    async (url, init) => {
      if (url.pathname !== `/repos/${env.CATALOG_REPO}/actions/workflows/apply.yml/dispatches`)
        return undefined
      const body = JSON.parse(await new Response(init.body).text())
      dispatched.push(body.inputs)
      return new Response(null, { status: 204 })
    },
  ]
}

async function useDeployKey() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer)
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`
  Object.assign(env, { DEPLOY_APP_ID: '123', DEPLOY_APP_PRIVATE_KEY: pem })
}

beforeEach(async () => {
  dispatched = []
  manifestBody = manifest
  for (const url of [`${env.CATALOG_URL}/v1/index.json`, `${RAW}/${env.CATALOG_REPO}/main/blocked.json`, `${RAW}/${env.CATALOG_REPO}/main/schema/entry.schema.json`, 'https://token.actions.githubusercontent.com/.well-known/jwks'])
    await caches.default.delete(url)
  await useDeployKey()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function signedIn() {
  const cookie = await signIn()
  vi.restoreAllMocks()
  mockFetch(...github())
  return cookie
}

describe('submission checks', () => {
  it('drafts the listing of a repository the user administers', async () => {
    const cookie = await signedIn()
    const body = await (await call('/api/submit/check', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip' } })).json() as { ok: boolean, checks: { key: string, status: string, reason?: string }[], draft: { id: string, name: Record<string, string>, categories: string[] } }
    expect(body.ok).toBe(true)
    expect(body.checks.find(c => c.key === 'claim')).toMatchObject({ status: 'pass', reason: 'admin' })
    expect(body.draft.id).toBe('io.github.octo-author.geoip')
    expect(body.draft.name).toEqual({ en: 'GeoIP Access', zh_CN: 'GeoIP 访问控制' })
    expect(body.draft.categories).toEqual(['security'])
  })

  it('reports every problem of a manifest at once', async () => {
    const cookie = await signedIn()
    manifestBody = { id: 'com.nginxui.geoip', name: 'Official GeoIP' }
    const body = await (await call('/api/submit/check', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip' } })).json() as { ok: boolean, checks: { key: string, status: string, reason?: string }[] }
    expect(body.ok).toBe(false)
    const failed = Object.fromEntries(body.checks.filter(c => c.status === 'fail').map(c => [c.key, c.reason]))
    expect(failed).toEqual({ plugin_id: 'reserved_namespace', name: 'reserved', package: 'missing' })
  })
})

describe('submit', () => {
  it('records the change and starts apply.yml', async () => {
    const cookie = await signedIn()
    const response = await call('/api/submit', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip', authorPublicKey: publicKey, categories: ['security'] } })
    expect(response.status).toBe(201)
    const { change } = await response.json() as { change: string }
    expect(change).toMatch(/^c_[\w-]{16}$/)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].change).toBe(change)
    expect(JSON.parse(dispatched[0].payload)).toMatchObject({
      kind: 'new_listing',
      repository_url: 'https://github.com/octo-author/geoip',
      categories: ['security'],
      submitter: { login: 'octo-author', id: 4242 },
      eligibility: '@octo-author has admin permission on octo-author/geoip',
    })
    const row = await env.DB.prepare('SELECT stage, waiting_on, state FROM changes WHERE id = ?').bind(change).first()
    expect(row).toEqual({ stage: 'checks', waiting_on: 'system', state: 'open' })
  })

  it('refuses a key that is not a minisign key', async () => {
    const cookie = await signedIn()
    const response = await call('/api/submit', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip', authorPublicKey: 'nope', categories: [] } })
    expect(response.status).toBe(422)
    expect(dispatched).toHaveLength(0)
  })

  it('refuses a repository that fails its checks', async () => {
    const cookie = await signedIn()
    manifestBody = { id: 'com.nginxui.geoip', name: 'GeoIP' }
    const response = await call('/api/submit', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip', authorPublicKey: publicKey } })
    expect(response.status).toBe(422)
  })
})

describe('apply report', () => {
  let signing: CryptoKeyPair

  async function oidc(claims: Record<string, unknown>) {
    const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)))
    const unsigned = `${encode({ alg: 'RS256', kid: 'test' })}.${encode(claims)}`
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(unsigned)))
    return `${unsigned}.${base64url(signature)}`
  }

  function claims(extra: Record<string, unknown> = {}) {
    const t = Math.floor(Date.now() / 1000)
    return { iss: 'https://token.actions.githubusercontent.com', aud: 'portal.test', iat: t, exp: t + 300, repository: env.CATALOG_REPO, workflow_ref: `${env.CATALOG_REPO}/.github/workflows/apply.yml@refs/heads/main`, run_id: '1', ...extra }
  }

  async function submitted(cookie: string) {
    const response = await call('/api/submit', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip', authorPublicKey: publicKey, categories: ['security'] } })
    return (await response.json() as { change: string }).change
  }

  beforeEach(async () => {
    signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  })

  function withJwks(cookie: string) {
    return crypto.subtle.exportKey('jwk', signing.publicKey).then((jwk) => {
      vi.restoreAllMocks()
      mockFetch(url => url.href === 'https://token.actions.githubusercontent.com/.well-known/jwks' ? json({ keys: [{ ...jwk, kid: 'test' }] }) : undefined, ...github())
      return cookie
    })
  }

  it('moves an opened pull request to review', async () => {
    const cookie = await withJwks(await signedIn())
    const change = await submitted(cookie)
    const response = await call('/api/hooks/apply', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${await oidc(claims())}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ change, outcome: 'opened', class: 'reviewed', pr_number: 12, run_url: 'https://github.com/nginxui/plugins/actions/runs/1', entry: { id: 'io.github.octo-author.geoip' } }),
    })
    expect(response.status).toBe(200)
    const row = await env.DB.prepare('SELECT stage, waiting_on, pr_number FROM changes WHERE id = ?').bind(change).first()
    expect(row).toEqual({ stage: 'review', waiting_on: 'maintainer', pr_number: 12 })
  })

  it('hands failed checks back to the author', async () => {
    const cookie = await withJwks(await signedIn())
    const change = await submitted(cookie)
    await call('/api/hooks/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await oidc(claims())}` },
      body: JSON.stringify({ change, outcome: 'checks_failed', problems: '- signature does not verify' }),
    })
    const row = await env.DB.prepare('SELECT stage, waiting_on, outcome_json FROM changes WHERE id = ?').bind(change).first<{ stage: string, waiting_on: string, outcome_json: string }>()
    expect(row).toMatchObject({ stage: 'checks', waiting_on: 'author' })
    expect(JSON.parse(row!.outcome_json).problems).toBe('- signature does not verify')
  })

  it.each([
    ['another repository', { repository: 'someone/plugins' }],
    ['another workflow', { workflow_ref: 'nginxui/plugins/.github/workflows/deploy.yml@refs/heads/main' }],
    ['another branch', { workflow_ref: 'nginxui/plugins/.github/workflows/apply.yml@refs/heads/evil' }],
    ['another audience', { aud: 'demo.nginxui.com' }],
    ['an expired token', { exp: 1000 }],
  ])('refuses a token of %s', async (_, extra) => {
    const cookie = await withJwks(await signedIn())
    const change = await submitted(cookie)
    const response = await call('/api/hooks/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await oidc(claims(extra))}` },
      body: JSON.stringify({ change, outcome: 'opened', pr_number: 1 }),
    })
    expect(response.status).toBe(401)
  })

  it('refuses a token signed by another key', async () => {
    const cookie = await withJwks(await signedIn())
    const change = await submitted(cookie)
    const token = await oidc(claims())
    signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
    const forged = `${token.split('.').slice(0, 2).join('.')}.${(await oidc(claims())).split('.')[2]}`
    const response = await call('/api/hooks/apply', { method: 'POST', headers: { Authorization: `Bearer ${forged}` }, body: JSON.stringify({ change, outcome: 'opened', pr_number: 1 }) })
    expect(response.status).toBe(401)
  })

  it('follows the pull request to merged and the plugin to live', async () => {
    const cookie = await withJwks(await signedIn())
    const change = await submitted(cookie)
    await call('/api/hooks/apply', { method: 'POST', headers: { Authorization: `Bearer ${await oidc(claims())}` }, body: JSON.stringify({ change, outcome: 'opened', pr_number: 12 }) })

    vi.restoreAllMocks()
    let listed = false
    mockFetch(
      url => url.pathname === `/repos/${env.CATALOG_REPO}/pulls/12` ? json({ state: 'closed', merged: true, merge_commit_sha: 'abc123' }) : undefined,
      url => url.href === `${env.CATALOG_URL}/v1/index.json` ? json({ plugins: listed ? [{ id: 'io.github.octo-author.geoip', name: { en: 'GeoIP Access' } }] : [] }) : undefined,
    )
    let body = await (await call(`/api/changes/${change}`, { cookie })).json() as { change: { stage: string, prUrl: string } }
    expect(body.change.stage).toBe('merged')
    expect(body.change.prUrl).toBe(`https://github.com/${env.CATALOG_REPO}/pull/12`)

    listed = true
    await caches.default.delete(`${env.CATALOG_URL}/v1/index.json`)
    body = await (await call(`/api/changes/${change}`, { cookie })).json() as { change: { stage: string, prUrl: string } }
    expect(body.change.stage).toBe('live')
    expect(await env.DB.prepare('SELECT state FROM plugins WHERE plugin_id = ?').bind('io.github.octo-author.geoip').first()).toEqual({ state: 'listed' })
  })
})
