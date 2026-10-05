import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, githubOAuth, mockFetch, signIn } from './helpers'

async function maintainer() {
  const cookie = await signIn({ push: true })
  vi.restoreAllMocks()
  mockFetch(...githubOAuth({ push: true }))
  return cookie
}

async function seed() {
  const t = Math.floor(Date.now() / 1000)
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id, login, created_at, last_seen_at) VALUES (77, 'octo', ?, ?)`).bind(t, t),
    env.DB.prepare(`INSERT INTO audit (actor_id, action, subject, detail_json, at) VALUES (77, 'change.self_service', 'io.github.octo.hello', '{"change":"c_1"}', ?)`).bind(t - 100),
    env.DB.prepare(`INSERT INTO audit (actor_id, action, subject, detail_json, at) VALUES (NULL, 'change.applied', 'io.github.octo.hello', '{"commit":"abcdef1234"}', ?)`).bind(t - 50),
    env.DB.prepare(`INSERT INTO audit (actor_id, action, subject, detail_json, at) VALUES (77, 'review.merge', '=cmd()', '{"pr":12}', ?)`).bind(t - 40 * 86400),
  ])
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('audit', () => {
  it('is for maintainers only', async () => {
    const cookie = await signIn()
    expect((await call('/api/audit', { cookie })).status).toBe(403)
  })

  // Ids follow insertion, which is the order records are written in.
  it('lists records last written first with their kind and record', async () => {
    const cookie = await maintainer()
    await seed()
    const body = await (await call('/api/audit', { cookie })).json() as { entries: { kind: string, actor: string | null, record: { url: string } | null }[], total: number }
    expect(body.entries.map(e => e.kind)).toEqual(['review', 'system', 'self_service', 'account'])
    expect(body.entries[1].record?.url).toBe(`https://github.com/${env.CATALOG_REPO}/commit/abcdef1234`)
    expect(body.entries[2].record?.url).toBe('/changes/c_1')
    expect(body.total).toBe(4)
  })

  it('filters by kind, actor, subject and time', async () => {
    const cookie = await maintainer()
    await seed()
    const get = async (query: string) => ((await (await call(`/api/audit?${query}`, { cookie })).json()) as { entries: { action: string }[] }).entries.map(e => e.action)
    expect(await get('kind=system')).toEqual(['change.applied'])
    expect(await get('actor=@OCTO')).toEqual(['review.merge', 'change.self_service'])
    expect(await get('subject=octo.hello')).toEqual(['change.applied', 'change.self_service'])
    expect(await get('actor=octo&days=30')).toEqual(['change.self_service'])
    expect(await get('subject=%25')).toEqual([])
  })

  // Every action falls under the kind its filter finds it by.
  it('files withdrawals, vendor members, partner requests and AI reviews under a kind', async () => {
    const cookie = await maintainer()
    const t = Math.floor(Date.now() / 1000)
    const actions = ['change.withdraw', 'vendor.member_add', 'partner.apply', 'ai.review', 'ai.glossary_sync', 'maintain.trust']
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (id, login, created_at, last_seen_at) VALUES (77, 'octo', ?, ?)`).bind(t, t),
      ...actions.map((action, i) => env.DB.prepare(`INSERT INTO audit (actor_id, action, subject, at) VALUES (77, ?, 'x', ?)`).bind(action, t - 60 + i)),
    ])
    const body = await (await call('/api/audit?actor=octo', { cookie })).json() as { entries: { action: string, kind: string }[] }
    expect(Object.fromEntries(body.entries.map(e => [e.action, e.kind]))).toEqual({
      'change.withdraw': 'self_service',
      'vendor.member_add': 'self_service',
      'partner.apply': 'submission',
      'ai.review': 'ai',
      'ai.glossary_sync': 'settings',
      'maintain.trust': 'maintainer',
    })
    for (const kind of ['self_service', 'submission', 'ai', 'settings', 'maintainer']) {
      const found = await (await call(`/api/audit?actor=octo&kind=${kind}`, { cookie })).json() as { entries: { kind: string }[] }
      expect(found.entries.length).toBeGreaterThan(0)
      expect(found.entries.every(e => e.kind === kind)).toBe(true)
    }
  })

  it('exports CSV without formulas', async () => {
    const cookie = await maintainer()
    await seed()
    const response = await call('/api/audit?format=csv&kind=review', { cookie })
    expect(response.headers.get('Content-Disposition')).toMatch(/attachment; filename="audit-.+\.csv"/)
    const lines = (await response.text()).trim().split('\r\n')
    expect(lines[0]).toBe('time,actor,kind,action,subject,record,detail')
    expect(lines[1]).toContain(`,octo,review,review.merge,'=cmd(),https://github.com/${env.CATALOG_REPO}/pull/12,"{""pr"":12}"`)
  })
})
