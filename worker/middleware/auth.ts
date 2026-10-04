import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { getCookie } from 'hono/cookie'
import { canWrite, repoPermission } from '../lib/github'
import { loadSession, recordMaintainer, SESSION_COOKIE, userToken } from '../lib/session'

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await loadSession(c.env, getCookie(c, SESSION_COOKIE))
  if (!session)
    return c.json({ error: 'unauthenticated' }, 401)
  c.set('session', session)
  await next()
}

export async function checkMaintainer(env: AppEnv['Bindings'], sessionId: string): Promise<boolean> {
  const token = await userToken(env, sessionId)
  let isMaintainer = false
  try {
    isMaintainer = canWrite((await repoPermission(token, env.CATALOG_REPO)).permission)
  }
  catch {
    isMaintainer = false
  }
  await recordMaintainer(env, sessionId, isMaintainer)
  return isMaintainer
}

// Maintainer rights are read from GitHub before every maintainer action,
// never taken from the session.
export const requireMaintainer: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!await checkMaintainer(c.env, c.get('session').id))
    return c.json({ error: 'not_maintainer' }, 403)
  await next()
}
