import type { Env } from '../env'

const SHA = /^[0-9a-f]{40}$/
const HEAD_KEY = 'catalog.head'

/**
 * Remembers the newest commit of the catalog repository the portal saw land:
 * its own merges, self service commits and deploy reports. Kept in D1, which
 * every location reads alike, unlike the cache of one location.
 */
export async function noteCatalogHead(env: Env, sha: string | null | undefined): Promise<void> {
  if (sha && SHA.test(sha)) {
    await env.DB.prepare('INSERT INTO job_state (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value')
      .bind(HEAD_KEY, sha)
      .run()
  }
}

/**
 * The ref catalog files are read at. A commit is never cached stale by
 * raw.githubusercontent.com, main is for up to five minutes.
 */
export async function catalogRef(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM job_state WHERE name = ?').bind(HEAD_KEY).first<{ value: string }>()
  return row && SHA.test(row.value) ? row.value : 'main'
}

export type Localized = Record<string, string>

export interface CatalogRelease {
  version: string
  yanked?: boolean
  channel?: string
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
  capabilities?: string[]
  license?: string
  trust?: string
  releases?: CatalogRelease[]
}

export interface CatalogIndex {
  updated_at?: string
  plugins: CatalogPlugin[]
  // Plugins the catalog took down, with what their entries had withdrawn.
  delisted?: { id: string, reason?: string, delisted_at: string, yanked?: string[], revoked_signers?: string[] }[]
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

/** Icons of the listed plugins by id; none when the index cannot be read. */
export async function pluginIcons(env: Env): Promise<Map<string, string>> {
  const catalog = await loadCatalog(env).catch(() => null)
  return new Map((catalog?.plugins ?? []).flatMap(p => p.icon_url ? [[p.id, p.icon_url] as const] : []))
}

// "owner/repo" of a GitHub repository URL, or null for anything else.
export function repoOf(url: string | undefined | null): string | null {
  if (!url)
    return null
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url)
  return match ? `${match[1]}/${match[2]}` : null
}

function versionParts(version: string): number[] {
  return version.replace(/^v/, '').split(/[-+]/)[0].split('.').map(n => Number(n) || 0)
}

/** Above zero when a is the newer version; a release beats its prereleases. */
export function compareVersions(a: string, b: string): number {
  const x = versionParts(a)
  const y = versionParts(b)
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i])
      return (x[i] ?? 0) - (y[i] ?? 0)
  }
  return Number(!a.includes('-')) - Number(!b.includes('-'))
}

/** The releases of a listing newest first; the catalog keeps them in no promised order. */
export function newestFirst<T extends { version: string }>(releases: T[] | undefined): T[] {
  return [...(releases ?? [])].sort((a, b) => compareVersions(b.version, a.version))
}

export function latestRelease(plugin: CatalogPlugin): CatalogRelease | null {
  return newestFirst(plugin.releases)[0] ?? null
}

export interface CatalogEntry {
  id: string
  yanked?: string[]
  revoked_signers?: string[]
  categories?: string[]
  [key: string]: unknown
}

/** The entry of a plugin on the main branch of the catalog repository. */
export async function catalogEntry(env: Env, id: string): Promise<CatalogEntry | null> {
  const response = await fetch(`https://raw.githubusercontent.com/${env.CATALOG_REPO}/${await catalogRef(env)}/plugins/${id}.json`, { cf: { cacheTtl: 30 } } as RequestInit)
  if (!response.ok)
    return null
  try {
    return await response.json() as CatalogEntry
  }
  catch {
    return null
  }
}
