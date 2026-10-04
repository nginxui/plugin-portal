import type { AppEnv, Env, Session } from '../env'
import type { RepoAccess, RepoOwner, Role } from '../lib/access'
import type { CatalogPlugin, Localized } from '../lib/catalog'
import { Hono } from 'hono'
import { mapLimit, repoAccess } from '../lib/access'
import { catalogEntry, latestRelease, loadCatalog, repoOf } from '../lib/catalog'
import { github, GitHubError } from '../lib/github'
import { insightsOf } from '../lib/insights'
import { userToken } from '../lib/session'
import { repoReleases } from '../lib/submission'
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
  // The entry of its newest change: a draft before the checks, the catalog
  // entry after them.
  entry_json: string | null
}

const PLUGIN_ROWS = `SELECT p.plugin_id, p.repo_full_name, p.state,
  (SELECT c.entry_json FROM changes c WHERE c.plugin_id = p.plugin_id ORDER BY c.updated_at DESC LIMIT 1) AS entry_json
  FROM plugins p`

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

// A plugin the portal knows that the published index does not list yet: a
// draft, or one listed by a deploy the cached index has not caught up with.
function summarizeDraft(row: PluginRow, access: RepoAccess | null): PluginSummary {
  let entry: { name?: Localized, description?: unknown, version?: string, categories?: string[], trust?: string } = {}
  try {
    entry = row.entry_json ? JSON.parse(row.entry_json) : {}
  }
  catch {}
  return {
    id: row.plugin_id,
    name: entry.name && typeof entry.name === 'object' ? entry.name : { en: row.plugin_id },
    description: entry.description && typeof entry.description === 'object' ? entry.description as Localized : null,
    iconUrl: null,
    repo: row.repo_full_name,
    owner: access?.owner ?? null,
    trust: entry.trust ?? null,
    categories: entry.categories ?? [],
    version: entry.version ?? null,
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
  const drafts = (await env.DB.prepare(PLUGIN_ROWS).all<PluginRow>()).results.filter(row => !listed.has(row.plugin_id))

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

// Downloads, completeness and repository activity of the listed plugins the
// user manages, loaded after the list so it stays fast.
plugins.get('/insights', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const [{ plugins: mine }, catalog] = await Promise.all([collectMine(c.env, session), loadCatalog(c.env)])
  const ids = new Set(mine.filter(p => p.state === 'listed').map(p => p.id))
  const listed = catalog.plugins.filter(p => ids.has(p.id))
  return c.json({ insights: await mapLimit(listed, 4, plugin => insightsOf(c.env, token, plugin)) })
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
    const row = await c.env.DB.prepare(`${PLUGIN_ROWS} WHERE p.plugin_id = ?`)
      .bind(id)
      .first<PluginRow>()
    if (!row)
      return c.json({ error: 'not_found' }, 404)
    access = row.repo_full_name ? await repoAccess(c.env, session.user.id, token, row.repo_full_name) : null
    summary = summarizeDraft(row, access)
    // Description and versions come from the releases, as the catalog reads them.
    if (row.repo_full_name) {
      const found = await repoReleases(token, row.repo_full_name)
      const newest = found.find(r => Object.keys(r.description).length) ?? found[0]
      if (newest) {
        summary = { ...summary, description: Object.keys(newest.description).length ? newest.description : summary.description, version: summary.version ?? newest.version, releasedAt: newest.releasedAt }
        releases = found.map(r => ({ version: r.version, released_at: r.releasedAt ?? undefined, min_nginx_ui_version: r.minNginxUiVersion ?? undefined, release_notes_url: r.url, signer: r.signer ?? undefined }))
      }
    }
  }
  if (!summary.role && !await checkMaintainer(c.env, session.id))
    return c.json({ error: 'no_access' }, 403)
  const [entry, pending, open] = await Promise.all([
    catalogEntry(c.env, id),
    c.env.DB.prepare(`SELECT id, kind FROM changes WHERE plugin_id = ? AND class = 'self_service' AND state IN ('open', 'merged') ORDER BY created_at DESC LIMIT 1`)
      .bind(id)
      .first<{ id: string, kind: string }>(),
    c.env.DB.prepare(`SELECT id, kind, class, stage, waiting_on, pr_number, payload_json, created_at, updated_at FROM changes
      WHERE plugin_id = ? AND state IN ('open', 'merged') ORDER BY created_at DESC LIMIT 5`)
      .bind(id)
      .all<{ id: string, kind: string, class: string, stage: string, waiting_on: string | null, pr_number: number | null, payload_json: string | null, created_at: number, updated_at: number }>(),
  ])
  const yanked = new Set(entry?.yanked ?? [])
  const revoked = new Set((entry?.revoked_signers ?? []).map(s => s.toUpperCase()))
  // The entry on main is newer than the published index between deploys.
  if (entry?.categories)
    summary = { ...summary, categories: entry.categories }
  return c.json({
    plugin: summary,
    releases: releases.map(r => ({
      version: r.version,
      releasedAt: r.released_at ?? null,
      minNginxUiVersion: r.min_nginx_ui_version ?? null,
      notesUrl: r.release_notes_url ?? null,
      signer: r.signer ?? null,
      yanked: yanked.has(r.version) || (!!r.signer && revoked.has(r.signer.toUpperCase())),
      yankedBy: yanked.has(r.version) ? 'version' : r.signer && revoked.has(r.signer.toUpperCase()) ? 'signer' : null,
      prerelease: r.channel ? r.channel !== 'stable' : r.version.includes('-'),
    })),
    revokedSigners: [...revoked],
    pending,
    // Changes still on their way, for the strip under the plugin header.
    openChanges: open.results.map(row => ({
      id: row.id,
      kind: row.kind,
      class: row.class,
      stage: row.stage,
      waitingOn: row.waiting_on,
      prNumber: row.pr_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    store: entry?.store ?? null,
    listed: !!entry,
    access: {
      role: summary.role,
      permission: access?.permission ?? null,
      checkedAt: access?.checkedAt ?? null,
      source: 'repository',
      manageUrl: summary.repo ? `https://github.com/${summary.repo}/settings/access` : null,
    },
  })
})
