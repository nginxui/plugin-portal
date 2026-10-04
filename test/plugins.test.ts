import type { Route } from './helpers'
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

function catalogAndRepos(...extra: Route[]) {
  return mockFetch(
    ...extra,
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
    // Entries on the catalog's main and certificates at tags are absent unless a test says otherwise.
    url => url.hostname === 'raw.githubusercontent.com' ? new Response('not found', { status: 404 }) : undefined,
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
  it('reports downloads, completeness and activity of listed plugins', async () => {
    const cookie = await signedIn()
    await caches.default.delete(`https://portal.cache/${encodeURIComponent('gh:octo-author/geoip')}`)
    await caches.default.delete(`https://portal.cache/${encodeURIComponent('gh:acme-labs/waf')}`)
    catalogAndRepos(url => url.pathname === '/repos/octo-author/geoip/releases'
      ? json([
          { tag_name: 'v0.3.0', published_at: '2026-10-02T00:00:00Z', prerelease: false, draft: false, assets: [{ name: 'p-0.3.0.tar.gz', download_count: 7 }, { name: 'p-0.3.0.tar.gz.sha256', download_count: 90 }] },
          { tag_name: 'v0.2.0', published_at: '2026-09-02T00:00:00Z', prerelease: false, draft: false, assets: [{ name: 'p-0.2.0.tar.gz', download_count: 3 }] },
          { tag_name: 'v0.4.0', published_at: null, prerelease: false, draft: true, assets: [] },
        ])
      : undefined)
    const body = await (await call('/api/plugins/insights', { cookie })).json() as { insights: { id: string, downloads: { version: string, count: number }[], untranslated: string[], storeSource: string }[] }
    const geoip = body.insights.find(i => i.id === 'io.github.octo.geoip')!
    expect(geoip.downloads).toEqual([{ version: '0.2.0', count: 3 }, { version: '0.3.0', count: 7 }])
    expect(geoip.untranslated).toHaveLength(13)
    expect(geoip.storeSource).toBe('release')
  })

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
    ])
    expect(body.installUrl).toBe('https://github.com/apps/nginx-ui-plugin-catalog/installations/new')

    // Other administered repositories load on request, without installed or listed ones.
    const more = await (await call('/api/plugins/repositories', { cookie })).json() as { repos: { repo: string, source: string }[] }
    expect(more.repos.map(i => [i.repo, i.source])).toEqual([
      ['octo-author/admin-only', 'admin'],
      ['octo-author/owned-only', 'admin'],
    ])
  })

  it('keeps a plugin the published index does not list yet, with the name of its newest change', async () => {
    const cookie = await signedIn()
    const t = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO plugins (plugin_id, repo_full_name, state, created_at, updated_at) VALUES ('io.github.octo-author.fresh', 'octo-author/geoip', 'listed', ?, ?)`).bind(t, t),
      env.DB.prepare(`INSERT INTO changes (id, plugin_id, author_id, kind, class, entry_json, state, stage, created_at, updated_at) VALUES ('c_fresh000000000', 'io.github.octo-author.fresh', 4242, 'new_listing', 'reviewed', ?, 'live', 'live', ?, ?)`)
        .bind(JSON.stringify({ id: 'io.github.octo-author.fresh', name: { en: 'Fresh' }, categories: ['security'], trust: 'community' }), t, t),
    ])
    catalogAndRepos()
    const body = await (await call('/api/plugins/mine', { cookie })).json() as { plugins: { id: string, state: string, name: Record<string, string> }[] }
    expect(body.plugins.find(p => p.id === 'io.github.octo-author.fresh')).toMatchObject({ state: 'listed', name: { en: 'Fresh' } })
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

  it('reads the description and versions of a plugin the index does not list yet from its releases', async () => {
    const cookie = await signedIn()
    const t = Math.floor(Date.now() / 1000)
    await env.DB.prepare(`INSERT INTO plugins (plugin_id, repo_full_name, state, created_at, updated_at) VALUES ('io.github.octo-author.fresh', 'octo-author/geoip', 'listed', ?, ?)`).bind(t, t).run()
    catalogAndRepos(
      url => url.pathname === '/repos/octo-author/geoip/releases' ? json([{ tag_name: 'v0.2.0', prerelease: false, draft: false, html_url: 'https://github.com/octo-author/geoip/releases/tag/v0.2.0', published_at: '2026-10-01T00:00:00Z', assets: [] }]) : undefined,
      url => url.href === 'https://raw.githubusercontent.com/octo-author/geoip/v0.2.0/plugin.json' ? new Response(JSON.stringify({ description: 'Fresh plugin.', i18n: { zh_CN: { description: '新插件。' } } })) : undefined,
    )
    const body = await (await call('/api/plugins/io.github.octo-author.fresh', { cookie })).json() as { plugin: { description: Record<string, string>, version: string }, releases: { version: string }[] }
    expect(body.plugin.description).toEqual({ en: 'Fresh plugin.', zh_CN: '新插件。' })
    expect(body.plugin.version).toBe('0.2.0')
    expect(body.releases.map(r => r.version)).toEqual(['0.2.0'])
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

  it('shows an organization page without the partner application for a publisher', async () => {
    const cookie = await signedIn()
    await caches.default.delete(`https://portal.cache/${encodeURIComponent('owner:acme-labs')}`)
    catalogAndRepos(
      url => url.href === 'https://api.github.com/users/acme-labs' ? json({ id: 900, login: 'acme-labs', name: null, avatar_url: '', type: 'Organization', html_url: '' }) : undefined,
      url => url.pathname === `/repos/${env.CATALOG_REPO}/contents/partners` ? json([]) : undefined,
    )
    const body = await (await call('/api/owners/acme-labs', { cookie })).json() as { canApply: boolean, accessUrl: string, plugins: { role: string }[] }
    expect(body.plugins.map(p => p.role)).toEqual(['publisher'])
    expect(body.canApply).toBe(false)
    expect(body.accessUrl).toBe('https://github.com/orgs/acme-labs/people')
  })
})
