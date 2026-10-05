import type { MiddlewareHandler } from 'hono'
import type { AppEnv, Env } from '../env'
import { now } from '../lib/time'

// Per user limits on the calls that reach GitHub, R2 or the catalog
// workflows (spec 13). The rate limiting bindings stop bursts within a
// minute; writes and uploads also have a daily cap read from D1, so a slow
// stream cannot add up either. A deployment without the bindings keeps only
// the daily caps.
type Kind = 'check' | 'write' | 'upload'

const BINDING: Record<Kind, 'LIMIT_CHECK' | 'LIMIT_WRITE' | 'LIMIT_UPLOAD'> = {
  check: 'LIMIT_CHECK',
  write: 'LIMIT_WRITE',
  upload: 'LIMIT_UPLOAD',
}

const DAY = 86400

export const DAILY = {
  // Changes a user opens in a day: submissions, store changes, self service.
  changes: 30,
  // Screenshots a user uploads in a day.
  uploads: 300,
}

async function overDaily(env: Env, kind: Kind, userId: number): Promise<boolean> {
  const since = now() - DAY
  if (kind === 'write') {
    const row = await env.DB.prepare('SELECT count(*) AS n FROM changes WHERE author_id = ? AND created_at > ?').bind(userId, since).first<{ n: number }>()
    return (row?.n ?? 0) >= DAILY.changes
  }
  if (kind === 'upload') {
    const row = await env.DB.prepare('SELECT count(*) AS n FROM media_drafts WHERE user_id = ? AND created_at > ?').bind(userId, since).first<{ n: number }>()
    return (row?.n ?? 0) >= DAILY.uploads
  }
  return false
}

/** Limits a route for the signed in user; runs after requireSession. */
export function limit(kind: Kind): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('session').user.id
    const binding = c.env[BINDING[kind]]
    if (binding && !(await binding.limit({ key: `${kind}:${user}` })).success)
      return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' })
    if (await overDaily(c.env, kind, user))
      return c.json({ error: 'daily_limit' }, 429)
    await next()
  }
}
