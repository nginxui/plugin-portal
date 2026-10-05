import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DAILY } from '../worker/middleware/limits'
import { call, signIn } from './helpers'

const now = () => Math.floor(Date.now() / 1000)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('per user limits', () => {
  it('stops a burst the rate limiting binding refuses', async () => {
    const cookie = await signIn()
    const keys: string[] = []
    Object.assign(env, {
      LIMIT_CHECK: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key)
          return { success: false }
        },
      },
    })
    const response = await call('/api/submit/check', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip' } })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await response.json()).toEqual({ error: 'rate_limited' })
    expect(keys).toEqual(['check:4242'])
  })

  it('caps the changes a user opens in a day', async () => {
    const cookie = await signIn()
    const t = now()
    await env.DB.batch(Array.from({ length: DAILY.changes }, (_, i) => env.DB.prepare(
      `INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, created_at, updated_at) VALUES (?, 'io.github.octo-author.geoip', 4242, 'store', 'self_service', 'withdrawn', 'withdrawn', ?, ?)`,
    ).bind(`c_limit${String(i).padStart(9, '0')}`, t - 60, t - 60)))
    const response = await call('/api/submit', { method: 'POST', mutate: true, cookie, json: { repo: 'octo-author/geoip' } })
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'daily_limit' })
  })

  it('counts only the last day of uploads', async () => {
    const cookie = await signIn()
    const t = now()
    const insert = (i: number, at: number) => env.DB.prepare('INSERT INTO media_drafts (key, user_id, sha256, width, height, created_at) VALUES (?, 4242, ?, 1280, 800, ?)').bind(`drafts/${i}`, String(i), at)
    await env.DB.batch(Array.from({ length: DAILY.uploads }, (_, i) => insert(i, t - 90000)))
    const old = await call('/api/media', { method: 'POST', mutate: true, cookie, body: new Uint8Array(4), headers: { 'Content-Type': 'image/webp' } })
    expect(old.status).toBe(415)
    await env.DB.batch(Array.from({ length: DAILY.uploads }, (_, i) => insert(DAILY.uploads + i, t - 60)))
    const fresh = await call('/api/media', { method: 'POST', mutate: true, cookie, body: new Uint8Array(4), headers: { 'Content-Type': 'image/webp' } })
    expect(fresh.status).toBe(429)
    expect(await fresh.json()).toEqual({ error: 'daily_limit' })
  })
})
