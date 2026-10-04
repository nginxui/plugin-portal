import type { Env } from '../env'
import type { CatalogPlugin } from './catalog'
import { cached } from './cache'
import { catalogEntry, repoOf } from './catalog'
import { github } from './github'
import { HOST_LOCALES } from './locales'

// What My plugins shows about a listed plugin beyond its summary: downloads
// GitHub counts for release assets, how complete its store texts and
// screenshots are, where its store texts come from and the activity of its
// repository. Nothing here is tracked by the portal itself.

export type StoreSource = 'release' | 'repo-branch' | 'repo-release' | 'catalog'

export interface Insights {
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
  releases: { version: string, publishedAt: string | null, yanked: boolean, prerelease: boolean }[]
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

export async function insightsOf(env: Env, token: string, plugin: CatalogPlugin & { screenshots?: { dark_url?: string }[], readme_url?: string }): Promise<Insights> {
  const repo = repoOf(plugin.repository_url)
  const [gh, entry] = await Promise.all([
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
  ])
  const yanked = new Set(plugin.releases?.filter(r => r.yanked).map(r => r.version))
  const newest = plugin.releases?.find(r => !r.yanked) ?? plugin.releases?.[0]
  const shots = plugin.screenshots ?? []
  return {
    id: plugin.id,
    downloads: gh.releases.slice(0, 6).reverse().map(r => ({ version: r.version, count: r.count })),
    platforms: (newest as { platforms?: string[] } | undefined)?.platforms?.length ?? null,
    ...coverage(plugin),
    screenshots: { total: shots.length, dark: shots.filter(s => s.dark_url).length },
    readme: !!plugin.readme_url,
    storeSource: storeSourceOf(entry?.store),
    minHostVersion: newest?.min_nginx_ui_version ?? null,
    openIssues: gh.openIssues,
    releases: gh.releases.slice(0, 5).map(r => ({ version: r.version, publishedAt: r.publishedAt, prerelease: r.prerelease, yanked: yanked.has(r.version) })),
  }
}
