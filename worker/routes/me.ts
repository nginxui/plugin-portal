import type { AppEnv } from '../env'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { MAIL_LOCALES } from '../lib/mailText'
import { loadSession, SESSION_COOKIE, SessionExpired } from '../lib/session'
import { now } from '../lib/time'
import { checkMaintainer, requireSession } from '../middleware/auth'

// How long the maintainer flag shown in the interface may be stale. Actions
// check again regardless.
const MAINTAINER_DISPLAY_SECONDS = 300

export const me = new Hono<AppEnv>()

me.get('/', async (c) => {
  const session = await loadSession(c.env, getCookie(c, SESSION_COOKIE))
  if (!session)
    return c.json({ user: null, isMaintainer: false })
  let isMaintainer = session.isMaintainer
  if (now() - session.maintainerCheckedAt > MAINTAINER_DISPLAY_SECONDS) {
    try {
      isMaintainer = await checkMaintainer(c.env, session.id)
    }
    catch (error) {
      if (error instanceof SessionExpired)
        return c.json({ user: null, isMaintainer: false })
      console.error('maintainer check failed', error)
    }
  }
  const row = await c.env.DB.prepare('SELECT locale FROM users WHERE id = ?').bind(session.user.id).first<{ locale: string | null }>()
  return c.json({ user: session.user, isMaintainer, locale: row?.locale ?? null })
})

// The interface language, kept so mail reaches the user in it.
me.put('/locale', requireSession, async (c) => {
  const locale = String((await c.req.json<{ locale?: string }>().catch(() => ({} as { locale?: string }))).locale ?? '')
  if (!MAIL_LOCALES.includes(locale))
    return c.json({ error: 'locale' }, 422)
  await c.env.DB.prepare('UPDATE users SET locale = ? WHERE id = ?').bind(locale, c.get('session').user.id).run()
  return c.json({ ok: true })
})
