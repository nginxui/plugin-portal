import type { Env } from '../env'

export type Localized = Record<string, string>

export interface CatalogRelease {
  version: string
  released_at?: string
  min_nginx_ui_version?: string
  release_notes_url?: string
  signer?: string
}

export interface CatalogPlugin {
  id: string
  name: Localized
  description?: Localized
  author?: string
  repository_url?: string
  icon_url?: string
  categories?: string[]
  license?: string
  trust?: string
  releases?: CatalogRelease[]
}

export interface CatalogIndex {
  updated_at?: string
  plugins: CatalogPlugin[]
}

// The published index changes with every deploy; a few minutes of staleness
// only delays what the portal shows, never what it allows.
const CACHE_SECONDS = 300

export async function loadCatalog(env: Env): Promise<CatalogIndex> {
  const url = `${env.CATALOG_URL}/v1/index.json`
  const cache = caches.default
  const cached = await cache.match(url)
  if (cached)
    return cached.json()
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok)
    throw new Error(`catalog index: ${response.status}`)
  const body = await response.text()
  await cache.put(url, new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` },
  }))
  return JSON.parse(body)
}

// "owner/repo" of a GitHub repository URL, or null for anything else.
export function repoOf(url: string | undefined | null): string | null {
  if (!url)
    return null
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url)
  return match ? `${match[1]}/${match[2]}` : null
}

export function latestRelease(plugin: CatalogPlugin): CatalogRelease | null {
  return plugin.releases?.[0] ?? null
}
