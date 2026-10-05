import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, githubOAuth, githubUser, json, mockFetch, publicKey, signIn } from './helpers'

const listing = { id: 'io.github.acme.waf', name: { en: 'WAF' }, repository_url: 'https://github.com/acme/waf', trust: 'community', releases: [{ version: '1.0.0' }] }
let dispatched: { change: string, payload: string }[] = []
let admin = true

function routes(): Route[] {
  return [
    url => url.href === `${env.CATALOG_URL}/v1/index.json` ? json({ plugins: [listing] }) : undefined,
    url => url.href === 'https://api.github.com/users/acme' ? json({ id: 900, login: 'acme', name: 'Acme', avatar_url: '', type: 'Organization', html_url: 'https://github.com/acme' }) : undefined,
    url => url.href === 'https://api.github.com/users/octo-author' ? json({ ...githubUser, type: 'User' }) : undefined,
    url => url.href === 'https://api.github.com/users/mei' ? json({ id: 555, login: 'mei', name: null, avatar_url: '', type: 'User', html_url: '' }) : undefined,
    url => url.href === 'https://api.github.com/repos/acme/waf' ? json({ id: 11, full_name: 'acme/waf', owner: { id: 900, login: 'acme', type: 'Organization', avatar_url: '' }, permissions: admin ? { admin: true, push: true, pull: true } : { pull: true } }) : undefined,
    url => url.pathname === `/repos/${env.CATALOG_REPO}/contents/partners` ? json([]) : undefined,
    url => url.pathname === `/repos/${env.CATALOG_REPO}/installation` ? json({ id: 9 }) : undefined,
    url => url.pathname === '/app/installations/9/access_tokens' ? json({ token: 'ghs' }) : undefined,
    async (url, init) => {
      if (url.pathname !== `/repos/${env.CATALOG_REPO}/actions/workflows/apply.yml/dispatches`)
        return undefined
      dispatched.push(JSON.parse(await new Response(init.body).text()).inputs)
      return new Response(null, { status: 204 })
    },
    url => url.hostname === 'raw.githubusercontent.com' ? new Response('not found', { status: 404 }) : undefined,
  ]
}

beforeEach(async () => {
  dispatched = []
  admin = true
  for (const key of ['owner:acme', `partners:${env.CATALOG_REPO}`, `blocked:${env.CATALOG_REPO}`])
    await caches.default.delete(`https://portal.cache/${encodeURIComponent(key)}`)
  await caches.default.delete(`${env.CATALOG_URL}/v1/index.json`)
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer)
  Object.assign(env, { DEPLOY_APP_ID: '1', DEPLOY_APP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function user(push = false) {
  const cookie = await signIn({ push })
  vi.restoreAllMocks()
  mockFetch(...routes(), ...githubOAuth({ push }))
  return cookie
}

describe('organizations and partners', () => {
  it('lists the plugins of an organization with the user role', async () => {
    const cookie = await user()
    const body = await (await call('/api/owners/acme', { cookie })).json() as { owner: { kind: string }, plugins: { id: string, role: string }[], canApply: boolean }
    expect(body.owner.kind).toBe('organization')
    expect(body.plugins).toEqual([expect.objectContaining({ id: 'io.github.acme.waf', role: 'admin' })])
    expect(body.canApply).toBe(true)
  })

  it('takes a partner application from an admin only', async () => {
    const cookie = await user()
    const apply = () => call('/api/owners/acme/partner-application', { method: 'POST', mutate: true, cookie, json: { name: 'acme', display_name: 'Acme Labs', homepage_url: 'https://acme.example', public_key: publicKey } })
    expect((await apply()).status).toBe(201)
    expect((await apply()).status).toBe(409)
    admin = false
    await env.DB.prepare('DELETE FROM repo_permissions').run()
    await env.DB.prepare('DELETE FROM partner_requests').run()
    expect((await apply()).status).toBe(403)
  })

  it('lets a maintainer approve an application as a partner pull request', async () => {
    const cookie = await user(true)
    await call('/api/owners/acme/partner-application', { method: 'POST', mutate: true, cookie, json: { name: 'acme', display_name: 'Acme Labs', public_key: publicKey } })
    const list = await (await call('/api/maintain/partners', { cookie })).json() as { requests: { id: string, checks: { listedPlugins: number } }[] }
    expect(list.requests[0].checks.listedPlugins).toBe(1)
    expect((await call(`/api/maintain/partner-requests/${list.requests[0].id}/approve`, { method: 'POST', mutate: true, cookie })).status).toBe(200)
    expect(JSON.parse(dispatched[0].payload)).toMatchObject({ kind: 'partner_update', partner: { name: 'acme', profile: { display_name: 'Acme Labs', kind: 'github_organization', github_owner: 'acme' } } })
  })
})

describe('vendors', () => {
  it('keeps the members of a vendor, never without an admin', async () => {
    const cookie = await user(true)
    const { id } = await (await call('/api/maintain/vendors', { method: 'POST', mutate: true, cookie, json: { slug: 'example-cloud', name: 'Example Cloud', partner: 'example-cloud', admins: ['octo-author'] } })).json() as { id: number }
    expect((await call(`/api/vendors/${id}/members`, { method: 'POST', mutate: true, cookie, json: { login: 'mei', role: 'publisher' } })).status).toBe(201)
    const detail = await (await call(`/api/vendors/${id}`, { cookie })).json() as { members: { login: string, role: string }[], canManage: boolean }
    expect(detail.members.map(m => [m.login, m.role])).toEqual([['octo-author', 'admin'], ['mei', 'publisher']])
    expect((await call(`/api/vendors/${id}/members/${githubUser.id}`, { method: 'DELETE', mutate: true, cookie })).status).toBe(409)
    expect((await call(`/api/vendors/${id}/members/555`, { method: 'DELETE', mutate: true, cookie })).status).toBe(200)
  })

  it('submits a vendor plugin through apply.yml', async () => {
    const cookie = await user(true)
    const { id } = await (await call('/api/maintain/vendors', { method: 'POST', mutate: true, cookie, json: { slug: 'example-cloud', name: 'Example Cloud', partner: 'example-cloud', admins: ['octo-author'] } })).json() as { id: number }
    const response = await call(`/api/vendors/${id}/plugins`, { method: 'POST', mutate: true, cookie, json: { id: 'com.example.log', name: { en: 'Log Shipper' }, releases_url: 'https://example.com/releases.json', categories: ['logs'] } })
    expect(response.status).toBe(201)
    expect(JSON.parse(dispatched[0].payload)).toMatchObject({ kind: 'vendor_listing', listing: { id: 'com.example.log', partner: 'example-cloud' } })
  })
})

describe('maintainer actions', () => {
  it('changes trust and delists through reviewed pull requests', async () => {
    const cookie = await user(true)
    expect((await call('/api/maintain/plugins/io.github.acme.waf/trust', { method: 'POST', mutate: true, cookie, json: { trust: 'verified' } })).status).toBe(422)
    expect((await call('/api/maintain/plugins/io.github.acme.waf/trust', { method: 'POST', mutate: true, cookie, json: { trust: 'verified', reason: 'Partner since today.' } })).status).toBe(201)
    await call('/api/maintain/plugins/io.github.acme.waf/delist', { method: 'POST', mutate: true, cookie, json: { reason: 'Copies another plugin.', block: true, repository: 'acme/waf' } })
    expect(dispatched.map(d => JSON.parse(d.payload))).toEqual([
      expect.objectContaining({ kind: 'maintainer_update', trust: 'verified' }),
      expect.objectContaining({ kind: 'maintainer_update', delist: { reason: 'Copies another plugin.' }, block: { plugin: true, repository: 'acme/waf', reason: 'Copies another plugin.' } }),
    ])
    const list = await (await call('/api/maintain/plugins', { cookie })).json() as { plugins: { id: string, openChanges: number }[], counts: { listed: number } }
    expect(list.counts.listed).toBe(1)
    expect(list.plugins[0].openChanges).toBe(2)
  })

  it('lists a plugin the published index has not caught up with as listed', async () => {
    const t = Math.floor(Date.now() / 1000)
    await env.DB.prepare(`INSERT INTO plugins (plugin_id, repo_full_name, state, created_at, updated_at) VALUES ('io.github.acme.probe', 'acme/probe', 'listed', ?, ?)`).bind(t, t).run()
    const cookie = await user(true)
    vi.restoreAllMocks()
    mockFetch(
      url => url.pathname === '/repos/acme/probe/releases' ? json([{ tag_name: 'v0.2.0', prerelease: false, draft: false, html_url: '#', published_at: '2026-10-01T00:00:00Z', assets: [] }]) : undefined,
      url => url.href === `https://raw.githubusercontent.com/${env.CATALOG_REPO}/main/plugins/io.github.acme.probe.json` ? json({ id: 'io.github.acme.probe', name: { en: 'Probe' }, trust: 'community' }) : undefined,
      ...routes(),
      ...githubOAuth({ push: true }),
    )
    const list = await (await call('/api/maintain/plugins', { cookie })).json() as { plugins: { id: string, state: string, version: string | null, name: Record<string, string> }[], counts: { listed: number } }
    expect(list.plugins.find(p => p.id === 'io.github.acme.probe')).toMatchObject({ state: 'listed', version: '0.2.0', name: { en: 'Probe' } })
    expect(list.counts.listed).toBe(2)
  })
})
