import type { Env } from '../env'
import type { CatalogPlugin } from './catalog'
import { cached } from './cache'
import { catalogEntry, repoOf } from './catalog'
import { dailyDownloads } from './downloads'
import { github } from './github'
import { HOST_LOCALES } from './locales'

// What My plugins shows about a listed plugin beyond its summary: downloads
// GitHub counts for release assets, how complete its store texts and
// screenshots are, where its store texts come from and the activity of its
// repository. Nothing here is tracked by the portal itself.

export type StoreSource = 'release' | 'repo-branch' | 'repo-release' | 'catalog'

export interface Insights {
  // Downloads per day over the last 30 days, once the daily snapshots allow.
  daily: { day: string, count: number }[]
  id: string
  downloads: { version: string, count: number }[]
  platforms: number | null
  translated: string[]
  untranslated: string[]
  screenshots: { total: number, dark: number }
  readme: boolean
  storeSource: StoreSource
  minHostVersion: string | null
  openIssues: number | null
  // listedAt: when the catalog first listed the version, if a deploy report saw it happen.
  releases: { version: string, publishedAt: string | null, yanked: boolean, prerelease: boolean, listed: boolean, listedAt: number | null, yankReason: string | null }[]
}

interface GitHubRelease {
  tag_name: string
  published_at: string | null
  prerelease: boolean
  draft: boolean
  assets: { name: string, download_count: number }[]
}

interface RepoInfo {
  open_issues_count: number
}

const CACHE_SECONDS = 600

export function storeSourceOf(store: unknown): StoreSource {
  const s = store as { source?: string, follow?: string } | undefined
  if (s?.source === 'catalog')
    return 'catalog'
  if (s?.source === 'repo')
    return s.follow === 'release' ? 'repo-release' : 'repo-branch'
  return 'release'
}

/** Languages a plugin has a name or description in, against the host's. */
export function coverage(plugin: Pick<CatalogPlugin, 'name' | 'description'>) {
  const has = new Set([...Object.keys(plugin.name ?? {}), ...Object.keys(plugin.description ?? {})])
  return {
    translated: HOST_LOCALES.filter(l => has.has(l)),
    untranslated: HOST_LOCALES.filter(l => !has.has(l)),
  }
}

const version = (tag: string) => tag.replace(/^v/, '')

/** When the catalog first listed each version, as deploy reports saw it. */
async function listingTimes(env: Env, pluginId: string): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare('SELECT version, listed_at FROM release_listings WHERE plugin_id = ? AND listed_at IS NOT NULL')
    .bind(pluginId)
    .all<{ version: string, listed_at: number }>()
  return new Map(results.map(r => [r.version, r.listed_at]))
}

export async function insightsOf(env: Env, token: string, plugin: CatalogPlugin & { screenshots?: { dark_url?: string }[], readme_url?: string }): Promise<Insights> {
  const repo = repoOf(plugin.repository_url)
  const [gh, entry, daily, listedAt] = await Promise.all([
    repo
      ? cached(`gh:${repo.toLowerCase()}`, CACHE_SECONDS, async () => {
          const [releases, info] = await Promise.all([
            github<GitHubRelease[]>(`/repos/${repo}/releases?per_page=10`, token).catch(() => [] as GitHubRelease[]),
            github<RepoInfo>(`/repos/${repo}`, token).catch(() => null),
          ])
          return {
            releases: releases.filter(r => !r.draft).map(r => ({
              version: version(r.tag_name),
              publishedAt: r.published_at,
              prerelease: r.prerelease,
              // Packages only: digests and signatures are fetched by every check.
              count: r.assets.filter(a => a.name.endsWith('.tar.gz')).reduce((sum, a) => sum + a.download_count, 0),
            })),
            openIssues: info?.open_issues_count ?? null,
          }
        })
      : Promise.resolve({ releases: [], openIssues: null }),
    catalogEntry(env, plugin.id),
    dailyDownloads(env, plugin.id),
    listingTimes(env, plugin.id),
  ])
  const yanked = new Set(plugin.releases?.filter(r => r.yanked).map(r => r.version))
  const listed = new Set(plugin.releases?.map(r => r.version))
  // The reasons authors gave when they yanked a version.
  const reasons = new Map<string, string>()
  if (yanked.size) {
    const { results } = await env.DB.prepare(`SELECT payload_json FROM changes WHERE plugin_id = ? AND class = 'self_service' AND state IN ('merged', 'live') ORDER BY created_at DESC LIMIT 20`)
      .bind(plugin.id)
      .all<{ payload_json: string | null }>()
    for (const row of results) {
      const payload = row.payload_json ? JSON.parse(row.payload_json) as { operations?: { yank?: string[] }, reason?: string } : {}
      for (const version of payload.operations?.yank ?? []) {
        if (payload.reason && !reasons.has(version))
          reasons.set(version, payload.reason)
      }
    }
  }
  const newest = plugin.releases?.find(r => !r.yanked) ?? plugin.releases?.[0]
  const shots = plugin.screenshots ?? []
  return {
    id: plugin.id,
    daily,
    downloads: gh.releases.slice(0, 6).reverse().map(r => ({ version: r.version, count: r.count })),
    platforms: (newest as { platforms?: string[] } | undefined)?.platforms?.length ?? null,
    ...coverage(plugin),
    screenshots: { total: shots.length, dark: shots.filter(s => s.dark_url).length },
    readme: !!plugin.readme_url,
    storeSource: storeSourceOf(entry?.store),
    minHostVersion: newest?.min_nginx_ui_version ?? null,
    openIssues: gh.openIssues,
    releases: gh.releases.slice(0, 5).map(r => ({ version: r.version, publishedAt: r.publishedAt, prerelease: r.prerelease, yanked: yanked.has(r.version), listed: listed.has(r.version), listedAt: listedAt.get(r.version) ?? null, yankReason: reasons.get(r.version)?.slice(0, 120) ?? null })),
  }
}
