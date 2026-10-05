import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { botConfig, mailConfig } from '../worker/lib/settings'
import { call, githubOAuth, json, mockFetch, signIn } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

async function maintainer(...extra: Route[]) {
  const cookie = await signIn({ push: true })
  vi.restoreAllMocks()
  mockFetch(...extra, ...githubOAuth({ push: true }))
  return cookie
}

describe('settings', () => {
  it('is for maintainers only', async () => {
    const cookie = await signIn()
    expect((await call('/api/settings', { cookie })).status).toBe(403)
  })

  it('keeps the mail key sealed, falls back to the Worker variables and back', async () => {
    Object.assign(env, { EMAIL_API_URL: 'https://env.example/send', EMAIL_API_KEY: 'env-key', EMAIL_FROM: 'env@example.com' })
    try {
      expect((await mailConfig(env))?.source).toBe('env')
      const cookie = await maintainer()
      const saved = await call('/api/settings/mail', { method: 'PUT', mutate: true, cookie, json: { url: 'https://mail.example/send', from: 'Portal <portal@example.com>', key: 're_secret' } })
      expect(saved.status).toBe(200)
      const view = await saved.json() as { mail: { url: string, keySet: boolean, active: string } }
      expect(view.mail).toMatchObject({ url: 'https://mail.example/send', keySet: true, active: 'settings' })
      expect(JSON.stringify(view)).not.toContain('re_secret')
      const stored = await env.DB.prepare(`SELECT value FROM settings WHERE name = 'mail.key'`).first<{ value: string }>()
      expect(stored?.value).not.toContain('re_secret')
      expect(await mailConfig(env)).toMatchObject({ key: 're_secret', source: 'settings' })

      // An empty key keeps the one saved.
      expect((await call('/api/settings/mail', { method: 'PUT', mutate: true, cookie, json: { url: 'https://mail.example/v2', from: 'portal@example.com', key: '' } })).status).toBe(200)
      expect(await mailConfig(env)).toMatchObject({ url: 'https://mail.example/v2', key: 're_secret' })

      await call('/api/settings/mail', { method: 'DELETE', mutate: true, cookie })
      expect((await mailConfig(env))?.source).toBe('env')
    }
    finally {
      Object.assign(env, { EMAIL_API_URL: undefined, EMAIL_API_KEY: undefined, EMAIL_FROM: undefined })
    }
  })

  it('takes a bot token only for the account it names', async () => {
    const cookie = await maintainer(
      (url, init) => url.href === 'https://api.github.com/user' && new Headers(init.headers).get('Authorization') === 'Bearer ghp_bot' ? json({ login: 'nginxui-bot' }) : undefined,
    )
    const wrong = await call('/api/settings/bot', { method: 'PUT', mutate: true, cookie, json: { login: 'someone-else', token: 'ghp_bot' } })
    expect(wrong.status).toBe(422)
    expect(await wrong.json()).toMatchObject({ error: 'token_login', login: 'nginxui-bot' })
    expect(await botConfig(env)).toBeNull()

    const right = await call('/api/settings/bot', { method: 'PUT', mutate: true, cookie, json: { login: 'nginxui-bot', token: 'ghp_bot' } })
    expect(right.status).toBe(200)
    expect(await botConfig(env)).toMatchObject({ login: 'nginxui-bot', token: 'ghp_bot', source: 'settings' })
    const audit = await env.DB.prepare(`SELECT detail_json FROM audit WHERE action = 'settings.bot'`).first<{ detail_json: string }>()
    expect(audit?.detail_json).not.toContain('ghp_bot')
  })

  it('lets maintainers write announcements that authors read', async () => {
    const cookie = await maintainer()
    expect((await call('/api/settings/announcements', { method: 'POST', mutate: true, cookie, json: { date: '2026-10-06', title: { zh_CN: '只有中文' }, text: { en: 'Text' } } })).status).toBe(422)
    const created = await call('/api/settings/announcements', { method: 'POST', mutate: true, cookie, json: { date: '2026-10-06', title: { en: 'Uploads are open', zh_CN: '截图上传已开放' }, text: { en: 'Upload screenshots in the studio.' } } })
    expect(created.status).toBe(201)
    const { id } = await created.json() as { id: number }
    expect((await call(`/api/settings/announcements/${id}`, { method: 'PUT', mutate: true, cookie, json: { date: '2026-10-07', title: { en: 'Uploads are open' }, text: { en: 'Upload them in the studio.' } } })).status).toBe(200)

    const author = await signIn()
    const list = await (await call('/api/announcements', { cookie: author })).json() as { announcements: { date: string, title: Record<string, string> }[] }
    expect(list.announcements[0]).toMatchObject({ date: '2026-10-07', title: { en: 'Uploads are open' } })

    vi.restoreAllMocks()
    mockFetch(...githubOAuth({ push: true }))
    expect((await call(`/api/settings/announcements/${id}`, { method: 'DELETE', mutate: true, cookie })).status).toBe(200)
    expect((await (await call('/api/announcements', { cookie: author })).json() as { announcements: unknown[] }).announcements).toEqual([])
  })
})
