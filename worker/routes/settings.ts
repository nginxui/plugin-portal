import type { AppEnv, Env } from '../env'
import { Hono } from 'hono'
import { audit } from '../lib/audit'
import { github, GitHubError } from '../lib/github'
import { sendMail } from '../lib/mail'
import { saveSettings, settingsView } from '../lib/settings'
import { now } from '../lib/time'
import { requireMaintainer, requireSession } from '../middleware/auth'

// The Settings page of maintainers: announcements, the mail API and the bot
// account. Secrets can be replaced but never read back.

export const settings = new Hono<AppEnv>()

const PORTAL_LOCALES = ['en', 'zh_CN']
const EMAIL = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/

interface AnnouncementRow {
  id: number
  date: string
  title_json: string
  text_json: string
}

const present = (row: AnnouncementRow) => ({ id: row.id, date: row.date, title: JSON.parse(row.title_json) as Record<string, string>, text: JSON.parse(row.text_json) as Record<string, string> })

async function listAnnouncements(env: Env, limit: number) {
  const { results } = await env.DB.prepare('SELECT id, date, title_json, text_json FROM announcements ORDER BY date DESC, id DESC LIMIT ?').bind(limit).all<AnnouncementRow>()
  return results.map(present)
}

// Signed in users read the newest few on My plugins.
settings.get('/announcements', requireSession, async c => c.json({ announcements: await listAnnouncements(c.env, 5) }))

settings.use('/settings/*', requireSession, requireMaintainer)
settings.use('/settings', requireSession, requireMaintainer)

settings.get('/settings', async c => c.json({ ...await settingsView(c.env), announcements: await listAnnouncements(c.env, 50) }))

function localized(input: unknown, max: number): Record<string, string> | null {
  if (!input || typeof input !== 'object')
    return null
  const out: Record<string, string> = {}
  for (const locale of PORTAL_LOCALES) {
    const text = String((input as Record<string, unknown>)[locale] ?? '').trim()
    if (text.length > max)
      return null
    if (text)
      out[locale] = text
  }
  return out.en ? out : null
}

function cleanAnnouncement(body: { date?: string, title?: unknown, text?: unknown }) {
  const date = String(body.date ?? '')
  const title = localized(body.title, 80)
  const text = localized(body.text, 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
    return { error: 'date' as const }
  if (!title)
    return { error: 'title' as const }
  if (!text)
    return { error: 'text' as const }
  return { date, title, text }
}

settings.post('/settings/announcements', async (c) => {
  const session = c.get('session')
  const input = cleanAnnouncement(await c.req.json())
  if ('error' in input)
    return c.json({ error: input.error }, 422)
  const t = now()
  const row = await c.env.DB.prepare('INSERT INTO announcements (date, title_json, text_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(input.date, JSON.stringify(input.title), JSON.stringify(input.text), session.user.id, t, t)
    .first<{ id: number }>()
  await audit(c.env.DB, { actorId: session.user.id, action: 'settings.announcement_create', detail: { id: row?.id, title: input.title.en } })
  return c.json({ id: row?.id }, 201)
})

settings.put('/settings/announcements/:id', async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const input = cleanAnnouncement(await c.req.json())
  if ('error' in input)
    return c.json({ error: input.error }, 422)
  const result = await c.env.DB.prepare('UPDATE announcements SET date = ?, title_json = ?, text_json = ?, updated_at = ? WHERE id = ?')
    .bind(input.date, JSON.stringify(input.title), JSON.stringify(input.text), now(), id)
    .run()
  if (!result.meta.changes)
    return c.json({ error: 'not_found' }, 404)
  await audit(c.env.DB, { actorId: session.user.id, action: 'settings.announcement_update', detail: { id, title: input.title.en } })
  return c.json({ ok: true })
})

settings.delete('/settings/announcements/:id', async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('DELETE FROM announcements WHERE id = ? RETURNING title_json').bind(id).first<{ title_json: string }>()
  if (!row)
    return c.json({ error: 'not_found' }, 404)
  await audit(c.env.DB, { actorId: session.user.id, action: 'settings.announcement_delete', detail: { id, title: (JSON.parse(row.title_json) as Record<string, string>).en } })
  return c.json({ ok: true })
})

settings.put('/settings/mail', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ url?: string, from?: string, key?: string }>()
  const url = String(body.url ?? '').trim()
  const from = String(body.from ?? '').trim()
  const key = String(body.key ?? '').trim()
  if (!/^https:\/\/\S+$/.test(url))
    return c.json({ error: 'url' }, 422)
  // "Name <address>" or a bare address.
  if (!EMAIL.test(/<([^>]+)>\s*$/.exec(from)?.[1] ?? from))
    return c.json({ error: 'from' }, 422)
  const current = await settingsView(c.env)
  if (!key && !current.mail.keySet)
    return c.json({ error: 'key' }, 422)
  await saveSettings(c.env, session.user.id, { 'mail.url': url, 'mail.from': from, ...(key ? { 'mail.key': key } : {}) }, ['mail.key'])
  await audit(c.env.DB, { actorId: session.user.id, action: 'settings.mail', detail: { url, from, keyChanged: !!key } })
  return c.json(await settingsView(c.env))
})

settings.delete('/settings/mail', async (c) => {
  const session = c.get('session')
  await saveSettings(c.env, session.user.id, { 'mail.url': null, 'mail.from': null, 'mail.key': null })
  await audit(c.env.DB, { actorId: session.user.id, action: 'settings.mail_clear' })
  return c.json(await settingsView(c.env))
})

settings.post('/settings/mail/test', async (c) => {
  const to = String((await c.req.json<{ to?: string }>()).to ?? '').trim()
  if (!EMAIL.test(to))
    return c.json({ error: 'to' }, 422)
  const ok = await sendMail(c.env, to, 'Test mail from the Nginx UI developer portal', 'This is a test. Authors who turn on email get progress mail from this sender.')
  return ok ? c.json({ ok: true }) : c.json({ error: 'send_failed' }, 502)
})

settings.put('/settings/bot', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ login?: string, token?: string }>()
  const login = String(body.login ?? '').trim()
  const token = String(body.token ?? '').trim()
  if (!/^[A-Z0-9](?:[A-Z0-9-]{0,37}[A-Z0-9])?$/i.test(login))
    return c.json({ error: 'login' }, 422)
  const current = await settingsView(c.env)
  if (!token && !current.bot.tokenSet)
    return c.json({ error: 'token' }, 422)
  // A new token must belong to the account named.
  if (token) {
    try {
      const user = await github<{ login: string }>('/user', token)
      if (user.login.toLowerCase() !== login.toLowerCase())
        return c.json({ error: 'token_login', login: user.login }, 422)
    }
    catch (error) {
      if (error instanceof GitHubError)
        return c.json({ error: 'token_invalid' }, 422)
      throw error
    }
  }
  else if (current.bot.login.toLowerCase() !== login.toLowerCase()) {
    return c.json({ error: 'token' }, 422)
  }
  await saveSettings(c.env, session.user.id, { 'bot.login': login, ...(token ? { 'bot.token': token } : {}) }, ['bot.token'])
  await audit(c.env.DB, { actorId: session.user.id, action: 'settings.bot', detail: { login, tokenChanged: !!token } })
  return c.json(await settingsView(c.env))
})

settings.delete('/settings/bot', async (c) => {
  const session = c.get('session')
  await saveSettings(c.env, session.user.id, { 'bot.login': null, 'bot.token': null })
  await audit(c.env.DB, { actorId: session.user.id, action: 'settings.bot_clear' })
  return c.json(await settingsView(c.env))
})
