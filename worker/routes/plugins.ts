import type { AppEnv, Env, Session } from '../env'
import type { RepoAccess, RepoOwner, Role } from '../lib/access'
import type { CatalogPlugin, Localized } from '../lib/catalog'
import { Hono } from 'hono'
import { mapLimit, repoAccess } from '../lib/access'
import { latestRelease, loadCatalog, repoOf } from '../lib/catalog'
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
  repoId: number
  installedAt: number
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

  const taken = new Set([...repos])
  const installable = (await env.DB.prepare(
    `SELECT repo_full_name AS repo, repo_id AS repoId, max(added_at) AS installedAt FROM installations
     WHERE installed_by = ? AND removed_at IS NULL GROUP BY repo_id ORDER BY installedAt DESC`,
  ).bind(session.user.id).all<Installable>()).results.filter(i => !taken.has(i.repo.toLowerCase()))

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
