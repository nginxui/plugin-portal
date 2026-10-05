import type { AppEnv } from '../env'
import { Hono } from 'hono'
import { mailEnabled } from '../lib/mail'
import { now } from '../lib/time'
import { requireSession } from '../middleware/auth'

// Notifications in the portal: what happened to the user's changes, made by
// someone else or by the catalog, and the user's preferences (spec 11.1).

interface Prefs {
  in_app: number
  email_on_action: number
  email_on_live: number
  email: string | null
  read_at: number | null
}

const DEFAULTS: Prefs = { in_app: 1, email_on_action: 0, email_on_live: 0, email: null, read_at: null }

export const notifications = new Hono<AppEnv>()

notifications.use('*', requireSession)

notifications.get('/', async (c) => {
  const user = c.get('session').user.id
  const prefs = await c.env.DB.prepare('SELECT * FROM notify_prefs WHERE user_id = ?').bind(user).first<Prefs>() ?? DEFAULTS
  if (!prefs.in_app)
    return c.json({ items: [], unread: 0 })
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.stage, e.at, e.detail_json, ch.id AS change_id, ch.number AS change_number, ch.kind, ch.plugin_id, ch.entry_json, u.login AS actor
     FROM change_events e JOIN changes ch ON ch.id = e.change_id LEFT JOIN users u ON u.id = e.actor_id
     WHERE ch.author_id = ? AND (e.actor_id IS NULL OR e.actor_id != ?) AND e.stage != 'submitted'
     ORDER BY e.at DESC, e.id DESC LIMIT 30`,
  ).bind(user, user).all<{ id: number, stage: string, at: number, detail_json: string | null, change_id: string, change_number: number | null, kind: string, plugin_id: string | null, entry_json: string | null, actor: string | null }>()
  const items = results.map(r => ({
    id: r.id,
    stage: r.stage,
    at: r.at,
    change: r.change_id,
    number: r.change_number,
    kind: r.kind,
    pluginId: r.plugin_id,
    name: r.entry_json ? (JSON.parse(r.entry_json) as { name?: Record<string, string> }).name ?? null : null,
    actor: r.actor,
    detail: r.detail_json ? JSON.parse(r.detail_json) : null,
    unread: r.at > (prefs.read_at ?? 0),
  }))
  return c.json({ items, unread: items.filter(i => i.unread).length })
})

notifications.post('/read', async (c) => {
  const user = c.get('session').user.id
  await c.env.DB.prepare(
    `INSERT INTO notify_prefs (user_id, read_at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET read_at = excluded.read_at`,
  ).bind(user, now()).run()
  return c.json({ ok: true })
})

notifications.get('/prefs', async (c) => {
  const prefs = await c.env.DB.prepare('SELECT * FROM notify_prefs WHERE user_id = ?').bind(c.get('session').user.id).first<Prefs>() ?? DEFAULTS
  return c.json({ inApp: !!prefs.in_app, emailOnAction: !!prefs.email_on_action, emailOnLive: !!prefs.email_on_live, email: prefs.email, mail: await mailEnabled(c.env) })
})

notifications.put('/prefs', async (c) => {
  const body = await c.req.json<{ inApp?: boolean, emailOnAction?: boolean, emailOnLive?: boolean, email?: string | null }>().catch(() => ({} as Record<string, never>))
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 200) : null
  if (email && !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email))
    return c.json({ error: 'invalid_email' }, 422)
  await c.env.DB.prepare(
    `INSERT INTO notify_prefs (user_id, in_app, email_on_action, email_on_live, email) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET in_app = excluded.in_app, email_on_action = excluded.email_on_action, email_on_live = excluded.email_on_live, email = excluded.email`,
  ).bind(c.get('session').user.id, body.inApp === false ? 0 : 1, body.emailOnAction ? 1 : 0, body.emailOnLive ? 1 : 0, email).run()
  return c.json({ ok: true })
})
