import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { base64url } from '../worker/lib/crypto'
import { call, certificateSignature, json, mockFetch, publicKey, signIn } from './helpers'

const RAW = 'https://raw.githubusercontent.com'
const repo = { id: 77, full_name: 'octo-author/geoip', private: false, archived: false, default_branch: 'main', owner: { id: 4242, login: 'octo-author', type: 'User', avatar_url: '' }, license: { spdx_id: 'MIT' }, permissions: { admin: true, push: true, pull: true } }
const manifest = { id: 'io.github.octo-author.geoip', name: 'GeoIP Access', description: 'Allow or deny by country.', capabilities: ['security.blocklist'], i18n: { zh_CN: { name: 'GeoIP 访问控制' } } }
const release = { tag_name: 'v1.0.0', prerelease: false, draft: false, html_url: 'https://github.com/octo-author/geoip/releases/tag/v1.0.0', assets: [{ name: 'io.github.octo-author.geoip-1.0.0-linux-amd64.tar.gz' }] }

let dispatched: { change: string, payload: string }[] = []
let manifestBody: unknown = manifest
let signerFor = 'io.github.octo-author.geoip'

function github(): Route[] {
  return [
    url => url.href === `${env.CATALOG_URL}/v1/index.json` ? json({ plugins: [] }) : undefined,
    url => url.href === `${RAW}/${env.CATALOG_REPO}/main/blocked.json` ? json({ plugins: [], repositories: ['bad/repo'] }) : undefined,
    url => url.href === `${RAW}/${env.CATALOG_REPO}/main/schema/entry.schema.json` ? json({ $defs: { category: { enum: ['security', 'dns'] } } }) : undefined,
    url => url.href === 'https://api.github.com/repos/octo-author/geoip' ? json(repo) : undefined,
    url => url.href.startsWith('https://api.github.com/repos/octo-author/geoip/releases') ? json([release]) : undefined,
    url => url.href === `${RAW}/octo-author/geoip/v1.0.0/plugin.json` ? new Response(JSON.stringify(manifestBody)) : undefined,
    url => url.href === `${RAW}/octo-author/geoip/v1.0.0/plugin.signer` ? new Response(publicKey) : undefined,
    url => url.href === `${RAW}/octo-author/geoip/v1.0.0/plugin.signer.minisig` ? new Response(certificateSignature(signerFor)) : undefined,
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
  signerFor = 'io.github.octo-author.geoip'
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
    expect(body.checks.find(c => c.key === 'signer')).toMatchObject({ status: 'pass' })
  })

  it('refuses a certificate made for another plugin', async () => {
    const cookie = await signedIn()
    signerFor = 'io.github.someone.else'
    const body = await (await call('/api/submit/check', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip' } })).json() as { ok: boolean, checks: { key: string, status: string, reason?: string }[] }
    expect(body.ok).toBe(false)
    expect(body.checks.find(c => c.key === 'signer')).toMatchObject({ status: 'fail', reason: 'other_plugin' })
  })

  it('reports every problem of a manifest at once', async () => {
    const cookie = await signedIn()
    manifestBody = { id: 'com.nginxui.geoip', name: 'Official GeoIP' }
    const body = await (await call('/api/submit/check', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip' } })).json() as { ok: boolean, checks: { key: string, status: string, reason?: string }[] }
    expect(body.ok).toBe(false)
    const failed = Object.fromEntries(body.checks.filter(c => c.status === 'fail').map(c => [c.key, c.reason]))
    expect(failed).toEqual({ plugin_id: 'reserved_namespace', name: 'reserved', package: 'missing', signer: 'other_plugin' })
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

  it('keeps a started submission with the account until it is sent', async () => {
    const cookie = await signedIn()
    const draft = { repo: 'octo-author/geoip', id: 'io.github.octo-author.geoip', name: { en: 'GeoIP' }, step: 2, problem: null, publicKey, categories: ['security'] }
    expect((await call('/api/submit/drafts', { method: 'PUT', mutate: true, cookie, json: draft })).status).toBe(200)
    const listed = await (await call('/api/submit/drafts', { cookie })).json() as { drafts: { repo: string, step: number, publicKey: string, categories: string[] }[] }
    expect(listed.drafts).toMatchObject([{ repo: 'octo-author/geoip', step: 2, publicKey, categories: ['security'] }])
    expect((await call('/api/submit/drafts', { method: 'PUT', mutate: true, cookie, json: { repo: '../etc' } })).status).toBe(422)
    await call('/api/submit', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip', authorPublicKey: publicKey, categories: ['security'] } })
    expect((await (await call('/api/submit/drafts', { cookie })).json() as { drafts: unknown[] }).drafts).toEqual([])
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

  async function mergedChange(cookie: string) {
    const change = await submitted(cookie)
    const entry = { id: 'io.github.octo-author.geoip', name: { en: 'GeoIP Access' }, trust: 'community' }
    await env.DB.prepare(`UPDATE changes SET state = 'merged', stage = 'merged', entry_json = ? WHERE id = ?`).bind(JSON.stringify(entry), change).run()
    return { change, entry }
  }

  function deployClaims(extra: Record<string, unknown> = {}) {
    return claims({ workflow_ref: `${env.CATALOG_REPO}/.github/workflows/deploy.yml@refs/heads/main`, ...extra })
  }

  it('moves a merged change live once a deploy publishes its entry', async () => {
    const cookie = await withJwks(await signedIn())
    const { change, entry } = await mergedChange(cookie)
    const response = await call('/api/hooks/deploy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await oidc(deployClaims())}` },
      // The key order differs from the stored entry.
      body: JSON.stringify({ commit: 'abc', entries: { [entry.id]: { trust: 'community', name: { en: 'GeoIP Access' }, id: entry.id } }, listed: [entry.id] }),
    })
    expect(await response.json()).toEqual({ live: [change], names: [] })
    expect(await env.DB.prepare('SELECT state, stage FROM changes WHERE id = ?').bind(change).first()).toEqual({ state: 'live', stage: 'live' })
    expect(await env.DB.prepare('SELECT state FROM plugins WHERE plugin_id = ?').bind(entry.id).first()).toEqual({ state: 'listed' })
  })

  it('keeps a change merged while the deploy publishes another entry or no verified release', async () => {
    const cookie = await withJwks(await signedIn())
    const { change, entry } = await mergedChange(cookie)
    for (const body of [
      { commit: 'abc', entries: { [entry.id]: { ...entry, name: { en: 'Older name' } } }, listed: [entry.id] },
      { commit: 'abc', entries: { [entry.id]: entry }, listed: [] },
    ]) {
      const response = await call('/api/hooks/deploy', { method: 'POST', headers: { Authorization: `Bearer ${await oidc(deployClaims())}` }, body: JSON.stringify(body) })
      expect(await response.json()).toEqual({ live: [], names: [] })
    }
    expect(await env.DB.prepare('SELECT state FROM changes WHERE id = ?').bind(change).first()).toEqual({ state: 'merged' })
  })

  it('turns names waiting for review into one reviewed change per plugin', async () => {
    await withJwks(await signedIn())
    const id = 'io.github.octo-author.geoip'
    const report: { commit: string, entries: object, listed: string[], pending: { id: string, version?: string, names: Record<string, string> }[] } = { commit: 'abc', entries: {}, listed: [], pending: [{ id, version: '1.2.0', names: { 'zh_CN': '地理访问', 'bad locale': 'x' } }, { id: 'not an id', names: { en: 'X' } }] }
    const send = async () => (await call('/api/hooks/deploy', { method: 'POST', headers: { Authorization: `Bearer ${await oidc(deployClaims())}` }, body: JSON.stringify(report) })).json() as Promise<{ names: string[] }>
    const first = await send()
    expect(first.names).toHaveLength(1)
    const row = await env.DB.prepare('SELECT plugin_id, author_id, kind, class, state FROM changes WHERE id = ?').bind(first.names[0]).first()
    expect(row).toEqual({ plugin_id: id, author_id: 0, kind: 'names', class: 'reviewed', state: 'open' })
    expect(JSON.parse(dispatched.at(-1)!.payload)).toEqual({ kind: 'entry_update', system: true, plugin_id: id, version: '1.2.0', operations: { names: { zh_CN: '地理访问' } } })
    // An open change, then the same names declined, start nothing new.
    expect((await send()).names).toEqual([])
    await env.DB.prepare(`UPDATE changes SET state = 'rejected' WHERE id = ?`).bind(first.names[0]).run()
    expect((await send()).names).toEqual([])
    report.pending[0].names = { zh_CN: '地理访问控制' }
    expect((await send()).names).toHaveLength(1)
  })

  it('takes deploy reports from the deploy workflow only', async () => {
    const cookie = await withJwks(await signedIn())
    await mergedChange(cookie)
    const response = await call('/api/hooks/deploy', { method: 'POST', headers: { Authorization: `Bearer ${await oidc(claims())}` }, body: JSON.stringify({ entries: {}, listed: [] }) })
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
    let body = await (await call(`/api/changes/${change}`, { cookie })).json() as { change: { id: string, number: number, stage: string, prUrl: string } }
    expect(body.change.stage).toBe('merged')
    expect(body.change.prUrl).toBe(`https://github.com/${env.CATALOG_REPO}/pull/12`)
    // The short number opens the same change.
    expect(body.change.number).toBe(1)
    const byNumber = await (await call('/api/changes/1', { cookie })).json() as { change: { id: string } }
    expect(byNumber.change.id).toBe(body.change.id)

    listed = true
    await caches.default.delete(`${env.CATALOG_URL}/v1/index.json`)
    body = await (await call(`/api/changes/${change}`, { cookie })).json() as typeof body
    expect(body.change.stage).toBe('live')
    expect(await env.DB.prepare('SELECT state FROM plugins WHERE plugin_id = ?').bind('io.github.octo-author.geoip').first()).toEqual({ state: 'listed' })
  })
})

describe('self service', () => {
  async function listed(cookie: string) {
    const t = Math.floor(Date.now() / 1000)
    await env.DB.prepare(`INSERT INTO plugins (plugin_id, repo_full_name, state, created_at, updated_at) VALUES ('io.github.octo-author.geoip', 'octo-author/geoip', 'listed', ?, ?)`).bind(t, t).run()
    return cookie
  }

  it('sends the operations to apply.yml for an admin of the repository', async () => {
    const cookie = await listed(await signedIn())
    const response = await call('/api/plugins/io.github.octo-author.geoip/changes', { method: 'POST', mutate: true, cookie, json: { operations: { yank: ['1.0.0'] }, reason: 'Breaks the config' } })
    expect(response.status).toBe(201)
    const { change } = await response.json() as { change: string }
    expect(JSON.parse(dispatched[0].payload)).toMatchObject({ kind: 'entry_update', plugin_id: 'io.github.octo-author.geoip', operations: { yank: ['1.0.0'] }, reason: 'Breaks the config' })
    expect(await env.DB.prepare('SELECT kind, class, stage FROM changes WHERE id = ?').bind(change).first()).toEqual({ kind: 'yank', class: 'self_service', stage: 'checks' })
  })

  it('batches several operations, never both ways for one version', async () => {
    const cookie = await listed(await signedIn())
    expect((await call('/api/plugins/io.github.octo-author.geoip/changes', { method: 'POST', mutate: true, cookie, json: { operations: { yank: ['1.0.0'], unyank: ['1.0.0'] } } })).status).toBe(422)
    const response = await call('/api/plugins/io.github.octo-author.geoip/changes', { method: 'POST', mutate: true, cookie, json: { operations: { yank: ['1.0.0', '1.1.0'], unyank: ['0.9.0'] } } })
    expect(response.status).toBe(201)
    const { change } = await response.json() as { change: string }
    expect(await env.DB.prepare('SELECT kind FROM changes WHERE id = ?').bind(change).first()).toEqual({ kind: 'batch' })
  })

  it('takes known operations only and one change per plugin', async () => {
    const cookie = await listed(await signedIn())
    expect((await call('/api/plugins/io.github.octo-author.geoip/changes', { method: 'POST', mutate: true, cookie, json: { operations: { trust: ['official'] } } })).status).toBe(422)
    expect((await call('/api/plugins/io.github.octo-author.geoip/changes', { method: 'POST', mutate: true, cookie, json: { operations: { yank: ['1.0.0'] } } })).status).toBe(201)
    const busy = await call('/api/plugins/io.github.octo-author.geoip/changes', { method: 'POST', mutate: true, cookie, json: { operations: { unyank: ['1.0.0'] } } })
    expect(busy.status).toBe(409)
  })

  it('refuses someone who cannot publish to the repository', async () => {
    const cookie = await listed(await signedIn())
    const saved = repo.permissions
    repo.permissions = { admin: false, push: false, pull: true }
    try {
      expect((await call('/api/plugins/io.github.octo-author.geoip/changes', { method: 'POST', mutate: true, cookie, json: { operations: { categories: ['dns'] } } })).status).toBe(403)
    }
    finally {
      repo.permissions = saved
    }
  })

  it('moves a committed change to merged', async () => {
    const cookie = await listed(await signedIn())
    const { change } = await (await call('/api/plugins/io.github.octo-author.geoip/changes', { method: 'POST', mutate: true, cookie, json: { operations: { categories: ['dns'] } } })).json() as { change: string }
    const signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey('jwk', signing.publicKey)
    vi.restoreAllMocks()
    mockFetch(url => url.href === 'https://token.actions.githubusercontent.com/.well-known/jwks' ? json({ keys: [{ ...jwk, kid: 'self' }] }) : undefined)
    const t = Math.floor(Date.now() / 1000)
    const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)))
    const unsigned = `${encode({ alg: 'RS256', kid: 'self' })}.${encode({ iss: 'https://token.actions.githubusercontent.com', aud: 'portal.test', iat: t, exp: t + 300, repository: env.CATALOG_REPO, workflow_ref: `${env.CATALOG_REPO}/.github/workflows/apply.yml@refs/heads/main`, run_id: '9' })}`
    const token = `${unsigned}.${base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(unsigned))))}`
    const response = await call('/api/hooks/apply', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ change, outcome: 'committed', class: 'self_service', commit_sha: 'a'.repeat(40), entry: { id: 'io.github.octo-author.geoip', categories: ['dns'] } }) })
    expect(response.status).toBe(200)
    expect(await env.DB.prepare('SELECT state, stage, commit_sha FROM changes WHERE id = ?').bind(change).first()).toEqual({ state: 'merged', stage: 'merged', commit_sha: 'a'.repeat(40) })
  })
})
