import type { Env, Session } from '../env'
import type { GitHubUser, UserTokens } from './github'
import { open, randomToken, seal, sha256Hex } from './crypto'
import { refreshTokens } from './github'
import { now } from './time'

export const SESSION_COOKIE = '__Host-session'
export const SESSION_SECONDS = 7 * 24 * 3600
// Refresh a user token this long before GitHub expires it.
const REFRESH_MARGIN = 120

export class SessionExpired extends Error {}

interface SessionRow {
  id: string
  user_id: number
  login: string
  name: string | null
  avatar_url: string | null
  token_enc: string
  token_expires_at: number | null
  refresh_enc: string | null
  refresh_expires_at: number | null
  is_maintainer: number
  maintainer_checked_at: number
  expires_at: number
}

export async function upsertUser(db: D1Database, user: GitHubUser): Promise<void> {
  const t = now()
  await db.prepare(
    `INSERT INTO users (id, login, name, avatar_url, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT (id) DO UPDATE SET login = ?2, name = ?3, avatar_url = ?4, last_seen_at = ?5`,
  ).bind(user.id, user.login, user.name, user.avatar_url, t).run()
}

async function sealTokens(env: Env, id: string, tokens: UserTokens) {
  return {
    token: await seal(env.SESSION_KEY, tokens.accessToken, `session:${id}:access`),
    refresh: tokens.refreshToken ? await seal(env.SESSION_KEY, tokens.refreshToken, `session:${id}:refresh`) : null,
  }
}

// Returns the cookie value. Only its hash is stored.
export async function createSession(env: Env, userId: number, tokens: UserTokens): Promise<string> {
  const value = randomToken()
  const id = await sha256Hex(value)
  const t = now()
  let expiresAt = t + SESSION_SECONDS
  if (tokens.refreshExpiresAt)
    expiresAt = Math.min(expiresAt, tokens.refreshExpiresAt)
  else if (tokens.expiresAt)
    expiresAt = Math.min(expiresAt, tokens.expiresAt)
  const sealed = await sealTokens(env, id, tokens)
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_enc, token_expires_at, refresh_enc, refresh_expires_at, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, userId, sealed.token, tokens.expiresAt, sealed.refresh, tokens.refreshExpiresAt, t, expiresAt).run()
  return value
}

async function row(env: Env, id: string): Promise<SessionRow | null> {
  return env.DB.prepare(
    `SELECT s.*, u.login, u.name, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  ).bind(id, now()).first<SessionRow>()
}

export async function loadSession(env: Env, cookie: string | undefined): Promise<Session | null> {
  if (!cookie || cookie.length > 128)
    return null
  const r = await row(env, await sha256Hex(cookie))
  if (!r)
    return null
  return {
    id: r.id,
    user: { id: r.user_id, login: r.login, name: r.name, avatarUrl: r.avatar_url },
    isMaintainer: r.is_maintainer === 1,
    maintainerCheckedAt: r.maintainer_checked_at,
  }
}

export async function destroySession(env: Env, id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
}

// The user's GitHub token, refreshed when it is about to expire.
export async function userToken(env: Env, sessionId: string): Promise<string> {
  const r = await row(env, sessionId)
  if (!r)
    throw new SessionExpired()
  const t = now()
  if (!r.token_expires_at || r.token_expires_at - REFRESH_MARGIN > t)
    return open(env.SESSION_KEY, r.token_enc, `session:${r.id}:access`)
  if (!r.refresh_enc || (r.refresh_expires_at && r.refresh_expires_at <= t)) {
    await destroySession(env, r.id)
    throw new SessionExpired()
  }
  let tokens: UserTokens
  try {
    tokens = await refreshTokens({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      refreshToken: await open(env.SESSION_KEY, r.refresh_enc, `session:${r.id}:refresh`),
    }, t)
  }
  catch {
    await destroySession(env, r.id)
    throw new SessionExpired()
  }
  const sealed = await sealTokens(env, r.id, tokens)
  await env.DB.prepare(
    `UPDATE sessions SET token_enc = ?, token_expires_at = ?, refresh_enc = coalesce(?, refresh_enc),
     refresh_expires_at = coalesce(?, refresh_expires_at) WHERE id = ?`,
  ).bind(sealed.token, tokens.expiresAt, sealed.refresh, tokens.refreshExpiresAt, r.id).run()
  return tokens.accessToken
}

export async function recordMaintainer(env: Env, sessionId: string, isMaintainer: boolean): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET is_maintainer = ?, maintainer_checked_at = ? WHERE id = ?')
    .bind(isMaintainer ? 1 : 0, now(), sessionId)
    .run()
}

export function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
