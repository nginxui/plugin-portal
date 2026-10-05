import type { Env } from '../env'
import { mapLimit } from './access'
import { loadCatalog, repoOf } from './catalog'
import { readToken } from './deployApp'
import { github } from './github'

// Downloads over time. GitHub keeps only the running total of each release
// file, so the daily job writes the total of every listed plugin down once a
// day; two days apart, the difference is what was downloaded in between.

const today = () => new Date().toISOString().slice(0, 10)

/** The running total of package downloads over every release of a repository. */
export async function downloadTotal(token: string | null, repo: string): Promise<number | null> {
  let total = 0
  for (let page = 1; page <= 5; page++) {
    const releases = await github<{ draft: boolean, assets: { name: string, download_count: number }[] }[]>(`/repos/${repo}/releases?per_page=100&page=${page}`, token).catch(() => null)
    if (!releases)
      return page === 1 ? null : total
    for (const release of releases.filter(r => !r.draft))
      total += release.assets.filter(a => a.name.endsWith('.tar.gz')).reduce((sum, a) => sum + a.download_count, 0)
    if (releases.length < 100)
      break
  }
  return total
}

/** Writes today's totals of the listed plugins; returns how many were written. */
export async function snapshotDownloads(env: Env): Promise<number> {
  const catalog = await loadCatalog(env)
  const repos = new Map<string, string>()
  for (const plugin of catalog.plugins) {
    const repo = repoOf(plugin.repository_url)
    if (repo)
      repos.set(plugin.id, repo)
  }
  // Listed plugins the published index has not caught up with.
  const { results } = await env.DB.prepare(`SELECT plugin_id, repo_full_name FROM plugins WHERE state = 'listed' AND repo_full_name IS NOT NULL`).all<{ plugin_id: string, repo_full_name: string }>()
  for (const row of results) {
    if (!repos.has(row.plugin_id))
      repos.set(row.plugin_id, row.repo_full_name)
  }
  const token = await readToken(env).catch(() => null)
  const day = today()
  const totals = await mapLimit([...repos], 4, async ([id, repo]) => ({ id, total: await downloadTotal(token, repo) }))
  const known = totals.filter((t): t is { id: string, total: number } => t.total !== null)
  if (known.length)
    await env.DB.batch(known.map(t => env.DB.prepare('INSERT OR REPLACE INTO download_snapshots (plugin_id, day, total) VALUES (?, ?, ?)').bind(t.id, day, t.total)))
  return known.length
}

/** Downloads per day over the last 30 days, from the snapshots, oldest first. */
export async function dailyDownloads(env: Env, pluginId: string): Promise<{ day: string, count: number }[]> {
  const since = new Date(Date.now() - 31 * 86400 * 1000).toISOString().slice(0, 10)
  const { results } = await env.DB.prepare('SELECT day, total FROM download_snapshots WHERE plugin_id = ? AND day >= ? ORDER BY day')
    .bind(pluginId, since)
    .all<{ day: string, total: number }>()
  const out: { day: string, count: number }[] = []
  for (let i = 1; i < results.length; i++) {
    // A deleted release lowers the total; that day counts as none.
    out.push({ day: results[i].day, count: Math.max(0, results[i].total - results[i - 1].total) })
  }
  return out
}
