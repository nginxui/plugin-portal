import type { AppEnv } from '../env'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { loadSession, SESSION_COOKIE, SessionExpired } from '../lib/session'
import { now } from '../lib/time'
import { checkMaintainer } from '../middleware/auth'

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
  return c.json({ user: session.user, isMaintainer })
})
