import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerMailer } from 'worker-mailer'
import { sendMail } from '../worker/lib/mail'
import { botConfig, mailConfig } from '../worker/lib/settings'
import { sender, smtp } from '../worker/lib/smtp'
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

  it('sends test mail with a bearer key and a user agent, and says why it was refused', async () => {
    const cookie = await maintainer()
    await call('/api/settings/mail', { method: 'PUT', mutate: true, cookie, json: { url: 'https://api.resend.com/emails', from: 'portal@example.com', key: 're_key' } })
    const seen: Headers[] = []
    let refuse = false
    vi.restoreAllMocks()
    mockFetch(
      (url, init) => {
        if (url.href !== 'https://api.resend.com/emails')
          return undefined
        seen.push(new Headers(init.headers))
        return refuse ? json({ statusCode: 403, message: 'The from address is not verified.' }, 403) : json({ id: 'm1' })
      },
      ...githubOAuth({ push: true }),
    )
    expect((await call('/api/settings/mail/test', { method: 'POST', mutate: true, cookie, json: { to: 'someone@example.com' } })).status).toBe(200)
    expect(seen[0].get('Authorization')).toBe('Bearer re_key')
    expect(seen[0].get('User-Agent')).toBeTruthy()
    refuse = true
    const refused = await call('/api/settings/mail/test', { method: 'POST', mutate: true, cookie, json: { to: 'someone@example.com' } })
    expect(await refused.json()).toEqual({ error: 'send_failed', status: 403, message: 'The from address is not verified.' })
  })

  it('sends through SMTP, keeps the password sealed and drops the HTTP settings', async () => {
    const cookie = await maintainer()
    await call('/api/settings/mail', { method: 'PUT', mutate: true, cookie, json: { url: 'https://api.resend.com/emails', from: 'portal@example.com', key: 're_key' } })
    const put = (json: Record<string, unknown>) => call('/api/settings/mail', { method: 'PUT', mutate: true, cookie, json: { kind: 'smtp', from: 'Nginx UI <portal@example.com>', host: 'smtp.example.com', port: 587, ...json } })
    expect(await (await put({ port: 25, user: 'bob', password: 'pw' })).json()).toEqual({ error: 'port' })
    expect(await (await put({ host: 'smtp example', user: 'bob', password: 'pw' })).json()).toEqual({ error: 'host' })
    expect(await (await put({ user: 'bob' })).json()).toEqual({ error: 'password' })
    const saved = await put({ user: 'bob', password: 'smtp-secret' })
    expect(saved.status).toBe(200)
    const view = await saved.json() as { mail: Record<string, unknown> }
    expect(view.mail).toMatchObject({ kind: 'smtp', host: 'smtp.example.com', port: 587, user: 'bob', passwordSet: true, keySet: false, url: '', activeKind: 'smtp' })
    expect(JSON.stringify(view)).not.toContain('smtp-secret')
    expect((await env.DB.prepare(`SELECT value FROM settings WHERE name = 'mail.smtp_password'`).first<{ value: string }>())?.value).not.toContain('smtp-secret')
    expect(await env.DB.prepare(`SELECT value FROM settings WHERE name = 'mail.key'`).first()).toBeNull()
    // An empty password keeps the saved one for the same account.
    expect((await put({ user: 'bob', password: '', port: 465 })).status).toBe(200)
    expect(await mailConfig(env)).toMatchObject({ kind: 'smtp', port: 465, user: 'bob', password: 'smtp-secret' })

    const sent = vi.spyOn(smtp, 'send').mockResolvedValueOnce().mockRejectedValueOnce(new Error('Invalid login: 535 5.7.8 Authentication failed'))
    expect(await sendMail(env, 'someone@example.com', 'Subject', 'Text')).toEqual({ ok: true })
    expect(sent.mock.calls[0][0]).toMatchObject({ host: 'smtp.example.com', port: 465, user: 'bob' })
    expect(await sendMail(env, 'someone@example.com', 'Subject', 'Text')).toEqual({ ok: false, message: 'Invalid login: 535 5.7.8 Authentication failed' })
  })

  it('signs in to an SMTP server only over an encrypted connection', async () => {
    const auth = (WorkerMailer.prototype as unknown as { auth: (this: object) => Promise<void> }).auth
    await expect(auth.call({ allowAuth: true, secure: false })).rejects.toThrow(/STARTTLS/)
    expect(sender('Nginx UI <portal@example.com>')).toEqual({ name: 'Nginx UI', email: 'portal@example.com' })
    expect(sender('portal@example.com')).toEqual({ email: 'portal@example.com' })
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
