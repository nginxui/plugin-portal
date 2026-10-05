import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dailyDownloads, snapshotDownloads } from '../worker/lib/downloads'
import { json, mockFetch } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

const day = (offset: number) => new Date(Date.now() + offset * 86400 * 1000).toISOString().slice(0, 10)

describe('downloads over time', () => {
  it('writes the package total of every listed plugin once a day', async () => {
    await caches.default.delete(`${env.CATALOG_URL}/v1/index.json`)
    const t = Math.floor(Date.now() / 1000)
    await env.DB.prepare(`INSERT INTO plugins (plugin_id, repo_full_name, state, created_at, updated_at) VALUES ('io.github.acme.probe', 'acme/probe', 'listed', ?, ?)`).bind(t, t).run()
    mockFetch(
      url => url.href === `${env.CATALOG_URL}/v1/index.json` ? json({ plugins: [{ id: 'io.github.acme.waf', repository_url: 'https://github.com/acme/waf' }] }) : undefined,
      url => url.pathname === '/repos/acme/waf/releases'
        ? json([
            { draft: false, assets: [{ name: 'waf-1.1.0-linux-amd64.tar.gz', download_count: 30 }, { name: 'waf-1.1.0-linux-amd64.tar.gz.sha256', download_count: 9 }] },
            { draft: false, assets: [{ name: 'waf-1.0.0-linux-amd64.tar.gz', download_count: 12 }] },
            { draft: true, assets: [{ name: 'waf-1.2.0-linux-amd64.tar.gz', download_count: 99 }] },
          ])
        : undefined,
      url => url.pathname === '/repos/acme/probe/releases' ? json([{ draft: false, assets: [{ name: 'probe-0.1.0.tar.gz', download_count: 5 }] }]) : undefined,
    )
    expect(await snapshotDownloads(env)).toBe(2)
    const { results } = await env.DB.prepare('SELECT plugin_id, total FROM download_snapshots ORDER BY plugin_id').all()
    expect(results).toEqual([{ plugin_id: 'io.github.acme.probe', total: 5 }, { plugin_id: 'io.github.acme.waf', total: 42 }])
  })

  it('turns the daily totals into downloads per day', async () => {
    const insert = env.DB.prepare('INSERT INTO download_snapshots (plugin_id, day, total) VALUES (?, ?, ?)')
    await env.DB.batch([
      insert.bind('io.x.y', day(-40), 1),
      insert.bind('io.x.y', day(-3), 10),
      insert.bind('io.x.y', day(-2), 14),
      insert.bind('io.x.y', day(-1), 13),
      insert.bind('io.x.y', day(0), 20),
    ])
    expect(await dailyDownloads(env, 'io.x.y')).toEqual([
      { day: day(-2), count: 4 },
      { day: day(-1), count: 0 },
      { day: day(0), count: 7 },
    ])
  })
})
