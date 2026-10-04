import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mail, remind } from '../worker/jobs'
import { call, githubUser, json, mockFetch, signIn } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

async function seed(state = 'open', waiting = 'author', updated = Math.floor(Date.now() / 1000) - 20 * 3600) {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, waiting_on, created_at, updated_at) VALUES ('c_track0000001', 'io.x.y', ?, 'names', 'reviewed', ?, 'review', ?, ?, ?)`).bind(githubUser.id, state, waiting, updated, updated),
    env.DB.prepare(`INSERT INTO change_events (change_id, stage, actor_id, at) VALUES ('c_track0000001', 'changes_requested', NULL, ?)`).bind(updated),
  ])
}

describe('tracker', () => {
  it('lets the author withdraw an open change', async () => {
    const cookie = await signIn()
    vi.restoreAllMocks()
    await seed('open', 'maintainer')
    expect((await call('/api/changes/c_track0000001/withdraw', { method: 'POST', mutate: true, cookie })).status).toBe(200)
    expect(await env.DB.prepare(`SELECT state FROM changes WHERE id = 'c_track0000001'`).first()).toEqual({ state: 'withdrawn' })
    expect((await call('/api/changes/c_track0000001/withdraw', { method: 'POST', mutate: true, cookie })).status).toBe(409)
  })

  it('reminds once after 18 hours of waiting on the author', async () => {
    await seed()
    expect(await remind(env)).toBe(1)
    expect(await remind(env)).toBe(0)
  })

  it('notifies of events by others and mails who asked for it', async () => {
    const cookie = await signIn()
    vi.restoreAllMocks()
    await seed()
    const list = await (await call('/api/notifications', { cookie })).json() as { items: { stage: string }[], unread: number }
    expect(list.items.map(i => i.stage)).toEqual(['changes_requested'])
    expect(list.unread).toBe(1)
    await call('/api/notifications/read', { method: 'POST', mutate: true, cookie })
    expect(((await (await call('/api/notifications', { cookie })).json()) as { unread: number }).unread).toBe(0)

    await call('/api/notifications/prefs', { method: 'PUT', mutate: true, cookie, json: { inApp: true, emailOnAction: true, email: 'octo@example.com' } })
    Object.assign(env, { EMAIL_API_URL: 'https://mail.example/send', EMAIL_API_KEY: 'k', EMAIL_FROM: 'portal@nginxui.com' })
    const sent: unknown[] = []
    mockFetch(async (url, init) => {
      if (url.href !== 'https://mail.example/send')
        return undefined
      sent.push(JSON.parse(await new Response(init.body).text()))
      return json({ id: 'm1' })
    })
    expect(await mail(env)).toBe(1)
    expect(sent[0]).toMatchObject({ to: 'octo@example.com', from: 'portal@nginxui.com' })
    expect(await mail(env)).toBe(0)
  })
})
