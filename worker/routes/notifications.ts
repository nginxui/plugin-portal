import type { AppEnv, Env, Session } from '../env'
import { Hono } from 'hono'
import { pluginIcons } from '../lib/catalog'
import { github, GitHubError } from '../lib/github'
import { mailEnabled } from '../lib/mail'
import { userToken } from '../lib/session'
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
  cleared_at: number | null
}

const DEFAULTS: Prefs = { in_app: 1, email_on_action: 0, email_on_live: 0, email: null, read_at: null, cleared_at: null }

// Progress of a change that ended leaves the list after this long.
const KEEP = 30 * 86400

export const notifications = new Hono<AppEnv>()

notifications.use('*', requireSession)

notifications.get('/', async (c) => {
  const user = c.get('session').user.id
  const prefs = await c.env.DB.prepare('SELECT * FROM notify_prefs WHERE user_id = ?').bind(user).first<Prefs>() ?? DEFAULTS
  if (!prefs.in_app)
    return c.json({ items: [], unread: 0, inApp: false })
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.stage, e.at, e.detail_json, ch.id AS change_id, ch.number AS change_number, ch.kind, ch.class, ch.state, ch.waiting_on, ch.plugin_id, ch.entry_json, u.login AS actor
     FROM change_events e JOIN changes ch ON ch.id = e.change_id LEFT JOIN users u ON u.id = e.actor_id
     WHERE ch.author_id = ? AND (e.actor_id IS NULL OR e.actor_id != ?) AND e.stage != 'submitted'
       -- What waits for the user stays until it is dealt with, cleared or not.
       AND (e.at > ? OR (ch.state = 'open' AND ch.waiting_on = 'author'))
       AND (ch.state IN ('open', 'merged') OR e.at > ?)
     ORDER BY e.at DESC, e.id DESC LIMIT 30`,
  ).bind(user, user, prefs.cleared_at ?? 0, now() - KEEP).all<{ id: number, stage: string, at: number, detail_json: string | null, change_id: string, change_number: number | null, kind: string, class: string, state: string, waiting_on: string | null, plugin_id: string | null, entry_json: string | null, actor: string | null }>()
  const icons = results.length ? await pluginIcons(c.env) : new Map<string, string>()
  const items = results.map(r => ({
    id: r.id,
    stage: r.stage,
    at: r.at,
    change: r.change_id,
    iconUrl: icons.get(r.plugin_id ?? '') ?? null,
    number: r.change_number,
    kind: r.kind,
    class: r.class,
    // Where the change stands now, which tells whether it waits for the user.
    changeState: r.state,
    waitingOn: r.waiting_on,
    pluginId: r.plugin_id,
    name: r.entry_json ? (JSON.parse(r.entry_json) as { name?: Record<string, string> }).name ?? null : null,
    actor: r.actor,
    detail: r.detail_json ? JSON.parse(r.detail_json) : null,
    unread: r.at > (prefs.read_at ?? 0),
  }))
  return c.json({ items, unread: items.filter(i => i.unread).length, inApp: true })
})

notifications.post('/read', async (c) => {
  const user = c.get('session').user.id
  await c.env.DB.prepare(
    `INSERT INTO notify_prefs (user_id, read_at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET read_at = excluded.read_at`,
  ).bind(user, now()).run()
  return c.json({ ok: true })
})

// Clears the list: progress up to now no longer shows. The history of each
// change stays on its page.
notifications.post('/clear', async (c) => {
  const user = c.get('session').user.id
  const t = now()
  await c.env.DB.prepare(
    `INSERT INTO notify_prefs (user_id, read_at, cleared_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET read_at = excluded.read_at, cleared_at = excluded.cleared_at`,
  ).bind(user, t, t).run()
  return c.json({ ok: true })
})

// The addresses verified on the user's GitHub account, primary first; null
// while the portal may not read them (the Email addresses permission of the
// app, granted by the user when signing in).
async function verifiedEmails(env: Env, session: Session): Promise<{ email: string, primary: boolean }[] | null> {
  try {
    const list = await github<{ email: string, primary: boolean, verified: boolean }[]>('/user/emails', await userToken(env, session.id))
    return list.filter(e => e.verified && !e.email.endsWith('@users.noreply.github.com'))
      .map(e => ({ email: e.email, primary: e.primary }))
      .sort((a, b) => Number(b.primary) - Number(a.primary))
  }
  catch (error) {
    if (error instanceof GitHubError && (error.status === 403 || error.status === 404))
      return null
    throw error
  }
}

notifications.get('/prefs', async (c) => {
  const session = c.get('session')
  const [prefs, emails, mail] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM notify_prefs WHERE user_id = ?').bind(session.user.id).first<Prefs>(),
    verifiedEmails(c.env, session),
    mailEnabled(c.env),
  ])
  const p = prefs ?? DEFAULTS
  return c.json({ inApp: !!p.in_app, emailOnAction: !!p.email_on_action, emailOnLive: !!p.email_on_live, email: p.email, mail, emails })
})

notifications.put('/prefs', async (c) => {
  const body = await c.req.json<{ inApp?: boolean, emailOnAction?: boolean, emailOnLive?: boolean, email?: string | null }>().catch(() => ({} as Record<string, never>))
  const session = c.get('session')
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 200) : null
  // Mail goes only to an address verified on the user's own GitHub account,
  // so no one can make the portal mail somebody else.
  const saved = await c.env.DB.prepare('SELECT email FROM notify_prefs WHERE user_id = ?').bind(session.user.id).first<{ email: string | null }>()
  if (email && email.toLowerCase() !== saved?.email?.toLowerCase()) {
    const emails = await verifiedEmails(c.env, session)
    if (!emails)
      return c.json({ error: 'no_email_access' }, 422)
    if (!emails.some(e => e.email.toLowerCase() === email.toLowerCase()))
      return c.json({ error: 'unverified_email' }, 422)
  }
  await c.env.DB.prepare(
    `INSERT INTO notify_prefs (user_id, in_app, email_on_action, email_on_live, email) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET in_app = excluded.in_app, email_on_action = excluded.email_on_action, email_on_live = excluded.email_on_live, email = excluded.email`,
  ).bind(session.user.id, body.inApp === false ? 0 : 1, body.emailOnAction ? 1 : 0, body.emailOnLive ? 1 : 0, email).run()
  return c.json({ ok: true })
})
