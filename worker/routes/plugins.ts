import type { AppEnv, Env, Session } from '../env'
import type { RepoAccess, RepoOwner, Role } from '../lib/access'
import type { CatalogPlugin, Localized } from '../lib/catalog'
import { Hono } from 'hono'
import { mapLimit, repoAccess } from '../lib/access'
import { latestRelease, loadCatalog, repoOf } from '../lib/catalog'
import { github, GitHubError } from '../lib/github'
import { userToken } from '../lib/session'
import { checkMaintainer, requireSession } from '../middleware/auth'

export interface PluginSummary {
  id: string
  name: Localized
  description: Localized | null
  iconUrl: string | null
  repo: string | null
  owner: RepoOwner | null
  trust: string | null
  categories: string[]
  version: string | null
  releasedAt: string | null
  state: 'listed' | 'draft' | 'delisted'
  role: Role | null
  catalogUrl: string | null
}

export interface Installable {
  repo: string
  description: string | null
  // How the user may claim it: they installed the Catalog App, or administer it.
  source: 'installation' | 'admin'
  at: number | null
}

interface UserRepo {
  full_name: string
  description: string | null
  private: boolean
  archived: boolean
  fork: boolean
  pushed_at: string | null
  permissions?: { admin?: boolean }
}

// Public repositories the user may submit: the ones they installed the
// Catalog App on, as the release webhook recorded, and the ones they
// administer, read with their own token. Listed repositories are left out.
async function submittable(env: Env, session: Session, token: string, taken: Set<string>): Promise<Installable[]> {
  const out = new Map<string, Installable>()
  const installed = await env.DB.prepare(
    `SELECT repo_full_name AS repo, max(added_at) AS at FROM installations
     WHERE installed_by = ? AND removed_at IS NULL GROUP BY repo_id ORDER BY at DESC`,
  ).bind(session.user.id).all<{ repo: string, at: number }>()
  for (const row of installed.results)
    out.set(row.repo.toLowerCase(), { repo: row.repo, description: null, source: 'installation', at: row.at })

  // A GitHub App user token may list only repositories the app is installed
  // on, so the user's own public repositories are read as well; owning one
  // makes them its admin.
  const [listed, owned] = await Promise.all([
    github<UserRepo[]>('/user/repos?affiliation=owner,collaborator,organization_member&visibility=public&sort=pushed&per_page=100', token)
      .catch((error) => {
        if (error instanceof GitHubError)
          return [] as UserRepo[]
        throw error
      }),
    github<UserRepo[]>(`/users/${session.user.login}/repos?type=owner&sort=pushed&per_page=100`, token),
  ])
  const repos = [...listed, ...owned.map(r => ({ ...r, permissions: { admin: true } }))]
  for (const r of repos) {
    const key = r.full_name.toLowerCase()
    if (r.private || r.archived || r.fork || !r.permissions?.admin)
      continue
    const existing = out.get(key)
    if (existing)
      existing.description = r.description
    else
      out.set(key, { repo: r.full_name, description: r.description, source: 'admin', at: r.pushed_at ? Math.floor(Date.parse(r.pushed_at) / 1000) : null })
  }
  return [...out.values()].filter(item => !taken.has(item.repo.toLowerCase()))
}

interface PluginRow {
  plugin_id: string
  repo_full_name: string | null
  state: 'draft' | 'listed' | 'delisted'
}

function summarize(env: Env, plugin: CatalogPlugin, access: RepoAccess | null): PluginSummary {
  const release = latestRelease(plugin)
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description ?? null,
    iconUrl: plugin.icon_url ?? null,
    repo: repoOf(plugin.repository_url),
    owner: access?.owner ?? null,
    trust: plugin.trust ?? null,
    categories: plugin.categories ?? [],
    version: release?.version ?? null,
    releasedAt: release?.released_at ?? null,
    state: 'listed',
    role: access?.role ?? null,
    catalogUrl: `${env.CATALOG_URL}/plugins/${plugin.id}/`,
  }
}

function summarizeDraft(row: PluginRow, access: RepoAccess | null): PluginSummary {
  return {
    id: row.plugin_id,
    name: { en: row.plugin_id },
    description: null,
    iconUrl: null,
    repo: row.repo_full_name,
    owner: access?.owner ?? null,
    trust: null,
    categories: [],
    version: null,
    releasedAt: null,
    state: row.state,
    role: access?.role ?? null,
    catalogUrl: null,
  }
}

// Every listing and draft whose repository the user has a role on. Access is
// read from GitHub per repository, so the list follows the repository's
// collaborators and teams with nothing kept in the portal.
export async function collectMine(env: Env, session: Session) {
  const token = await userToken(env, session.id)
  const catalog = await loadCatalog(env)
  const listed = new Set(catalog.plugins.map(p => p.id))
  const drafts = (await env.DB.prepare(`SELECT plugin_id, repo_full_name, state FROM plugins WHERE state != 'listed'`)
    .all<PluginRow>()).results.filter(row => !listed.has(row.plugin_id))

  const repos = new Set<string>()
  for (const plugin of catalog.plugins) {
    const repo = repoOf(plugin.repository_url)
    if (repo)
      repos.add(repo.toLowerCase())
  }
  for (const row of drafts) {
    if (row.repo_full_name)
      repos.add(row.repo_full_name.toLowerCase())
  }
  const accessList = await mapLimit([...repos], 6, repo => repoAccess(env, session.user.id, token, repo))
  const access = new Map(accessList.map(a => [a.repo, a]))
  const accessOf = (repo: string | null) => repo ? access.get(repo.toLowerCase()) ?? null : null

  const plugins: PluginSummary[] = []
  for (const plugin of catalog.plugins) {
    const a = accessOf(repoOf(plugin.repository_url))
    if (a?.role)
      plugins.push(summarize(env, plugin, a))
  }
  for (const row of drafts) {
    const a = accessOf(row.repo_full_name)
    if (a?.role)
      plugins.push(summarizeDraft(row, a))
  }

  const installable = await submittable(env, session, token, repos)

  return { plugins, installable }
}

export const plugins = new Hono<AppEnv>()

plugins.use('*', requireSession)

plugins.get('/mine', async (c) => {
  const { plugins, installable } = await collectMine(c.env, c.get('session'))
  return c.json({ plugins, installable, installUrl: `https://github.com/apps/${c.env.CATALOG_APP_SLUG}/installations/new` })
})

plugins.get('/:id', async (c) => {
  const session = c.get('session')
  const id = c.req.param('id')
  const catalog = await loadCatalog(c.env)
  const plugin = catalog.plugins.find(p => p.id === id)
  let summary: PluginSummary
  let access: RepoAccess | null = null
  let releases: CatalogPlugin['releases'] = []
  const token = await userToken(c.env, session.id)
  if (plugin) {
    const repo = repoOf(plugin.repository_url)
    access = repo ? await repoAccess(c.env, session.user.id, token, repo) : null
    summary = summarize(c.env, plugin, access)
    releases = plugin.releases ?? []
  }
  else {
    const row = await c.env.DB.prepare('SELECT plugin_id, repo_full_name, state FROM plugins WHERE plugin_id = ?')
      .bind(id)
      .first<PluginRow>()
    if (!row)
      return c.json({ error: 'not_found' }, 404)
    access = row.repo_full_name ? await repoAccess(c.env, session.user.id, token, row.repo_full_name) : null
    summary = summarizeDraft(row, access)
  }
  if (!summary.role && !await checkMaintainer(c.env, session.id))
    return c.json({ error: 'no_access' }, 403)
  return c.json({
    plugin: summary,
    releases: releases.map(r => ({ version: r.version, releasedAt: r.released_at ?? null, minNginxUiVersion: r.min_nginx_ui_version ?? null, notesUrl: r.release_notes_url ?? null })),
    access: {
      role: summary.role,
      permission: access?.permission ?? null,
      checkedAt: access?.checkedAt ?? null,
      source: 'repository',
      manageUrl: summary.repo ? `https://github.com/${summary.repo}/settings/access` : null,
    },
  })
})
