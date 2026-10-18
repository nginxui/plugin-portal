import type { Env, Session } from '../env'
import type { RepoAccess, Role } from './access'
import type { CatalogEntry, CatalogPlugin } from './catalog'
import { checkMaintainer } from '../middleware/auth'
import { repoAccess, vendorPlugins } from './access'
import { catalogEntry, loadCatalog, newestFirst, repoOf } from './catalog'
import { userToken } from './session'
import { repoReleases } from './submission'

// A plugin as the pages that edit it need it: the listing, its repository,
// the release it is listed with, its entry on main and the user's role.

export interface PluginContext {
  id: string
  listing: CatalogPlugin | null
  repo: string | null
  version: string | null
  tag: string | null
  entry: CatalogEntry | null
  access: RepoAccess | null
  role: Role | null
  /** The vendor whose member the user is, for a plugin a vendor lists. */
  vendor: string | null
  isMaintainer: boolean
  token: string
}

/** The tag of a listed release: from its notes URL, else v and the version. */
export function tagOf(release: { version: string, release_notes_url?: string } | undefined | null): string | null {
  if (!release)
    return null
  const match = /\/releases\/tag\/([^/?#]+)/.exec(release.release_notes_url ?? '')
  return match ? decodeURIComponent(match[1]) : `v${release.version}`
}

export async function pluginContext(env: Env, session: Session, id: string): Promise<PluginContext | null> {
  const token = await userToken(env, session.id)
  const [catalog, entry] = await Promise.all([loadCatalog(env), catalogEntry(env, id)])
  const listing = catalog.plugins.find(p => p.id === id) ?? null
  let repo = repoOf(listing?.repository_url ?? (entry?.repository_url as string | undefined))
  if (!repo) {
    const row = await env.DB.prepare('SELECT repo_full_name FROM plugins WHERE plugin_id = ?').bind(id).first<{ repo_full_name: string | null }>()
    repo = row?.repo_full_name ?? null
  }
  if (!listing && !entry && !repo)
    return null
  const releases = newestFirst(listing?.releases)
  let release = releases.find(r => !r.yanked && (r.channel ?? 'stable') === 'stable') ?? releases[0] ?? null
  // A plugin the published index does not list yet: its newest release, as
  // the catalog reads it at the next update.
  if (!listing && repo) {
    const found = await repoReleases(token, repo)
    const newest = found.find(r => !r.version.includes('-')) ?? found[0]
    if (newest)
      release = { version: newest.version, release_notes_url: newest.url }
  }
  const access = repo ? await repoAccess(env, session.user.id, token, repo) : null
  // A plugin a vendor lists without a repository is edited by its members.
  const member = access?.role ? null : (await vendorPlugins(env, session.user.id, id)).get(id) ?? null
  const role = access?.role ?? member?.role ?? null
  const isMaintainer = role ? false : await checkMaintainer(env, session.id)
  return { id, listing, repo, version: release?.version ?? null, tag: tagOf(release), entry, access, role, vendor: member?.vendor ?? null, isMaintainer, token }
}
