import type { AppEnv } from '../env'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { audit } from '../lib/audit'
import { open, pkceChallenge, randomToken, seal, timingSafeEqual } from '../lib/crypto'
import { currentUser, exchangeCode } from '../lib/github'
import { createSession, destroySession, loadSession, SESSION_COOKIE, SESSION_SECONDS, sessionCookie, upsertUser } from '../lib/session'
import { now } from '../lib/time'

const OAUTH_COOKIE = '__Host-oauth'
const OAUTH_SECONDS = 600

interface OAuthState {
  s: string
  v: string
  n: string
  t: number
}

export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/api/'))
    return '/plugins'
  return next
}

function redirectUri(origin: string): string {
  return `${origin}/api/auth/callback`
}

export const auth = new Hono<AppEnv>()

auth.get('/login', async (c) => {
  const state: OAuthState = { s: randomToken(), v: randomToken(48), n: safeNext(c.req.query('next')), t: now() }
  setCookie(c, OAUTH_COOKIE, await seal(c.env.SESSION_KEY, JSON.stringify(state), 'oauth'), {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: OAUTH_SECONDS,
  })
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri(c.env.PORTAL_ORIGIN))
  url.searchParams.set('state', state.s)
  url.searchParams.set('code_challenge', await pkceChallenge(state.v))
  url.searchParams.set('code_challenge_method', 'S256')
  return c.redirect(url.toString(), 302)
})

auth.get('/callback', async (c) => {
  const fail = (reason: string) => c.redirect(`/signin?error=${reason}`, 302)
  const sealed = getCookie(c, OAUTH_COOKIE)
  deleteCookie(c, OAUTH_COOKIE, { path: '/', secure: true })
  if (c.req.query('error'))
    return fail('denied')
  if (!sealed)
    return fail('state')
  let state: OAuthState
  try {
    state = JSON.parse(await open(c.env.SESSION_KEY, sealed, 'oauth'))
  }
  catch {
    return fail('state')
  }
  const code = c.req.query('code')
  if (!code || !timingSafeEqual(state.s, c.req.query('state') ?? '') || now() - state.t > OAUTH_SECONDS)
    return fail('state')

  try {
    const tokens = await exchangeCode({
      clientId: c.env.GITHUB_CLIENT_ID,
      clientSecret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirectUri: redirectUri(c.env.PORTAL_ORIGIN),
      verifier: state.v,
    }, now())
    const user = await currentUser(tokens.accessToken)
    await upsertUser(c.env.DB, user)
    const value = await createSession(c.env, user.id, tokens)
    await audit(c.env.DB, { actorId: user.id, action: 'auth.sign_in' })
    c.header('Set-Cookie', sessionCookie(value, SESSION_SECONDS), { append: true })
    return c.redirect(safeNext(state.n), 302)
  }
  catch (error) {
    console.error('sign in failed', error)
    return fail('github')
  }
})

auth.post('/logout', async (c) => {
  const session = await loadSession(c.env, getCookie(c, SESSION_COOKIE))
  if (session)
    await destroySession(c.env, session.id)
  c.header('Set-Cookie', sessionCookie('', 0), { append: true })
  return c.body(null, 204)
})
