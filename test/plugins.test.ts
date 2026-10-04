import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, githubOAuth, json, mockFetch, signIn } from './helpers'

const catalog = {
  plugins: [
    { id: 'io.github.acme.waf', name: { en: 'WAF Rules' }, repository_url: 'https://github.com/acme-labs/waf', trust: 'community', releases: [{ version: '1.2.0', released_at: '2026-10-01T00:00:00Z' }] },
    { id: 'io.github.octo.geoip', name: { en: 'GeoIP Access' }, repository_url: 'https://github.com/octo-author/geoip', trust: 'community', releases: [{ version: '0.3.0' }] },
    { id: 'io.github.other.probe', name: { en: 'Uptime Probe' }, repository_url: 'https://github.com/other/probe', trust: 'community' },
    { id: 'io.github.gone.thing', name: { en: 'Gone' }, repository_url: 'https://github.com/gone/thing', trust: 'community' },
  ],
}

const repos: Record<string, { id: number, owner: { id: number, login: string, type: string }, permissions: Record<string, boolean> }> = {
  'acme-labs/waf': { id: 11, owner: { id: 900, login: 'acme-labs', type: 'Organization' }, permissions: { push: true, pull: true } },
  'octo-author/geoip': { id: 12, owner: { id: 4242, login: 'octo-author', type: 'User' }, permissions: { admin: true, push: true, pull: true } },
  'other/probe': { id: 13, owner: { id: 901, login: 'other', type: 'User' }, permissions: { pull: true } },
}

function catalogAndRepos() {
  return mockFetch(
    url => url.href === `${env.CATALOG_URL}/v1/index.json` ? json(catalog) : undefined,
    url => url.pathname === '/users/octo-author/repos'
      ? json([{ full_name: 'octo-author/owned-only', description: 'Mine', private: false, archived: false, fork: false, pushed_at: null }])
      : undefined,
    url => url.pathname === '/user/repos'
      ? json([
          { full_name: 'octo-author/admin-only', description: null, private: false, archived: false, fork: false, pushed_at: '2026-10-01T00:00:00Z', permissions: { admin: true } },
          { full_name: 'octo-author/geoip', description: 'GeoIP', private: false, archived: false, fork: false, pushed_at: null, permissions: { admin: true } },
          { full_name: 'octo-author/secret', description: null, private: true, archived: false, fork: false, pushed_at: null, permissions: { admin: true } },
          { full_name: 'octo-author/fork', description: null, private: false, archived: false, fork: true, pushed_at: null, permissions: { admin: true } },
          { full_name: 'someone/contrib', description: null, private: false, archived: false, fork: false, pushed_at: null, permissions: { admin: false, push: true } },
        ])
      : undefined,
    (url) => {
      const match = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname)
      if (url.hostname !== 'api.github.com' || !match)
        return undefined
      const repo = repos[match[1]]
      if (!repo)
        return json({ message: 'Not Found' }, 404)
      return json({ ...repo, full_name: match[1], owner: { ...repo.owner, avatar_url: '' } })
    },
    ...githubOAuth(),
  )
}

beforeEach(async () => {
  await caches.default.delete(`${env.CATALOG_URL}/v1/index.json`)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function signedIn() {
  const cookie = await signIn()
  vi.restoreAllMocks()
  return cookie
}

describe('my plugins', () => {
  it('lists the plugins whose repository the user has a role on', async () => {
    const cookie = await signedIn()
    catalogAndRepos()
    const body = await (await call('/api/plugins/mine', { cookie })).json() as { plugins: { id: string, role: string, owner: { login: string, kind: string } }[] }
    expect(body.plugins.map(p => [p.id, p.role])).toEqual([
      ['io.github.acme.waf', 'publisher'],
      ['io.github.octo.geoip', 'admin'],
    ])
    expect(body.plugins[0].owner).toMatchObject({ login: 'acme-labs', kind: 'organization' })
  })

  it('reads access from GitHub once within the cache time', async () => {
    const cookie = await signedIn()
    const spy = catalogAndRepos()
    await call('/api/plugins/mine', { cookie })
    await call('/api/plugins/mine', { cookie })
    const repoCalls = spy.mock.calls.filter(([input]) => String(input).includes('api.github.com/repos/acme-labs/waf'))
    expect(repoCalls).toHaveLength(1)
  })

  it('drops access when the cached permission runs out', async () => {
    const cookie = await signedIn()
    catalogAndRepos()
    await call('/api/plugins/mine', { cookie })
    await env.DB.prepare('UPDATE repo_permissions SET checked_at = 0').run()
    repos['acme-labs/waf'].permissions = { pull: true }
    try {
      const body = await (await call('/api/plugins/mine', { cookie })).json() as { plugins: { id: string }[] }
      expect(body.plugins.map(p => p.id)).toEqual(['io.github.octo.geoip'])
    }
    finally {
      repos['acme-labs/waf'].permissions = { push: true, pull: true }
    }
  })

  it('offers repositories the user installed the Catalog App on', async () => {
    const cookie = await signedIn()
    const insert = env.DB.prepare('INSERT INTO installations (installation_id, repo_id, repo_full_name, installed_by, installed_by_login, added_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    await env.DB.batch([
      insert.bind(1, 50, 'octo-author/new-plugin', 4242, 'octo-author', 100, null),
      insert.bind(1, 51, 'octo-author/removed', 4242, 'octo-author', 100, 200),
      insert.bind(1, 12, 'octo-author/geoip', 4242, 'octo-author', 100, null),
      insert.bind(2, 52, 'someone/else', 7, 'someone', 100, null),
    ])
    catalogAndRepos()
    const body = await (await call('/api/plugins/mine', { cookie })).json() as { installable: { repo: string, source: string }[], installUrl: string }
    expect(body.installable.map(i => [i.repo, i.source])).toEqual([
      ['octo-author/new-plugin', 'installation'],
      ['octo-author/admin-only', 'admin'],
      ['octo-author/owned-only', 'admin'],
    ])
    expect(body.installUrl).toBe('https://github.com/apps/nginx-ui-plugin-catalog/installations/new')
  })

  it('needs a session', async () => {
    expect((await call('/api/plugins/mine')).status).toBe(401)
  })
})

describe('plugin page', () => {
  it('shows a plugin to someone with a role', async () => {
    const cookie = await signedIn()
    catalogAndRepos()
    const response = await call('/api/plugins/io.github.acme.waf', { cookie })
    expect(response.status).toBe(200)
    const body = await response.json() as { access: { role: string, manageUrl: string }, releases: { version: string }[] }
    expect(body.access).toMatchObject({ role: 'publisher', manageUrl: 'https://github.com/acme-labs/waf/settings/access' })
    expect(body.releases[0].version).toBe('1.2.0')
  })

  it('refuses someone without a role', async () => {
    const cookie = await signedIn()
    catalogAndRepos()
    expect((await call('/api/plugins/io.github.other.probe', { cookie })).status).toBe(403)
  })

  it('shows any plugin to a maintainer', async () => {
    const cookie = await signedIn()
    repos[env.CATALOG_REPO] = { id: 1, owner: { id: 2, login: 'nginxui', type: 'Organization' }, permissions: { push: true } }
    try {
      catalogAndRepos()
      expect((await call('/api/plugins/io.github.other.probe', { cookie })).status).toBe(200)
    }
    finally {
      delete repos[env.CATALOG_REPO]
    }
  })

  it('is not found for an unknown id', async () => {
    const cookie = await signedIn()
    catalogAndRepos()
    expect((await call('/api/plugins/io.github.nobody.nothing', { cookie })).status).toBe(404)
  })
})

describe('owners', () => {
  it('groups plugins by their repository owner', async () => {
    const cookie = await signedIn()
    catalogAndRepos()
    const body = await (await call('/api/owners', { cookie })).json() as { owners: { login: string, role: string, plugins: number }[] }
    expect(body.owners).toEqual([
      expect.objectContaining({ login: 'acme-labs', kind: 'organization', role: 'publisher', plugins: 1 }),
      expect.objectContaining({ login: 'octo-author', kind: 'user', role: 'admin', plugins: 1 }),
    ])
  })

  it('shows an organization page without admin rights for a publisher', async () => {
    const cookie = await signedIn()
    catalogAndRepos()
    const body = await (await call('/api/owners/acme-labs', { cookie })).json() as { isAdmin: boolean, accessUrl: string }
    expect(body.isAdmin).toBe(false)
    expect(body.accessUrl).toBe('https://github.com/orgs/acme-labs/people')
  })
})
