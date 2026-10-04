import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pkceChallenge } from '../worker/lib/crypto'
import { userToken } from '../worker/lib/session'
import { safeNext } from '../worker/routes/auth'
import { call, cookiesOf, githubOAuth, json, mockFetch, signIn } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sign in', () => {
  it('sends the user to GitHub with state and PKCE', async () => {
    const response = await call('/api/auth/login?next=/plugins/demo')
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location')!)
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe(env.GITHUB_CLIENT_ID)
    expect(location.searchParams.get('redirect_uri')).toBe('https://portal.test/api/auth/callback')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('state')).toBeTruthy()
    const cookie = response.headers.getSetCookie().find(line => line.startsWith('__Host-oauth='))!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/Path=\//)
  })

  it('creates a session and returns to the page asked for', async () => {
    const login = await call('/api/auth/login?next=/plugins/demo')
    const oauth = cookiesOf(login)['__Host-oauth']
    const location = new URL(login.headers.get('Location')!)
    const fetchSpy = mockFetch(...githubOAuth())

    const callback = await call(`/api/auth/callback?code=abc&state=${location.searchParams.get('state')}`, {
      cookie: `__Host-oauth=${oauth}`,
    })
    expect(callback.status).toBe(302)
    expect(callback.headers.get('Location')).toBe('/plugins/demo')

    // The verifier sent to GitHub matches the challenge of the login.
    const exchange = fetchSpy.mock.calls.find(([input]) => String(input).includes('access_token'))!
    const body = new URLSearchParams(String(exchange[1]!.body))
    expect(await pkceChallenge(body.get('code_verifier')!)).toBe(location.searchParams.get('code_challenge'))

    const session = callback.headers.getSetCookie().find(line => line.startsWith('__Host-session='))!
    expect(session).toMatch(/HttpOnly/i)
    expect(session).toMatch(/SameSite=Lax/i)
    expect(session).not.toMatch(/Domain=/i)

    const row = await env.DB.prepare('SELECT token_enc FROM sessions').first<{ token_enc: string }>()
    expect(row!.token_enc).not.toContain('ghu_access')
    const signIns = await env.DB.prepare(`SELECT count(*) AS n FROM audit WHERE action = 'auth.sign_in'`).first<{ n: number }>()
    expect(signIns!.n).toBe(1)
  })

  it('refuses a callback whose state does not match', async () => {
    const login = await call('/api/auth/login')
    const oauth = cookiesOf(login)['__Host-oauth']
    const callback = await call('/api/auth/callback?code=abc&state=forged', { cookie: `__Host-oauth=${oauth}` })
    expect(callback.headers.get('Location')).toBe('/signin?error=state')
  })

  it('refuses a callback without the state cookie', async () => {
    const callback = await call('/api/auth/callback?code=abc&state=x')
    expect(callback.headers.get('Location')).toBe('/signin?error=state')
  })

  it('reports a denied authorization', async () => {
    const callback = await call('/api/auth/callback?error=access_denied')
    expect(callback.headers.get('Location')).toBe('/signin?error=denied')
  })
})

describe('me', () => {
  it('is empty without a session', async () => {
    expect(await (await call('/api/me')).json()).toEqual({ user: null, isMaintainer: false })
  })

  it('shows the user and maintainer rights read from GitHub', async () => {
    const cookie = await signIn({ push: true })
    const body = await (await call('/api/me', { cookie })).json() as { user: { login: string }, isMaintainer: boolean }
    expect(body.user.login).toBe('octo-author')
    expect(body.isMaintainer).toBe(true)
  })

  it('signs out', async () => {
    const cookie = await signIn()
    const logout = await call('/api/auth/logout', { method: 'POST', mutate: true, cookie })
    expect(logout.status).toBe(204)
    expect(await (await call('/api/me', { cookie })).json()).toEqual({ user: null, isMaintainer: false })
  })
})

describe('userToken', () => {
  it('refreshes an expired token', async () => {
    await signIn()
    const { id } = (await env.DB.prepare('SELECT id FROM sessions').first<{ id: string }>())!
    await env.DB.prepare('UPDATE sessions SET token_expires_at = 1').run()
    vi.restoreAllMocks()
    mockFetch(url => url.href === 'https://github.com/login/oauth/access_token'
      ? json({ access_token: 'ghu_new', expires_in: 28800, refresh_token: 'ghr_new', refresh_token_expires_in: 15897600 })
      : undefined)
    expect(await userToken(env, id)).toBe('ghu_new')
    expect(await userToken(env, id)).toBe('ghu_new')
  })

  it('ends the session when the refresh fails', async () => {
    await signIn()
    const { id } = (await env.DB.prepare('SELECT id FROM sessions').first<{ id: string }>())!
    await env.DB.prepare('UPDATE sessions SET token_expires_at = 1').run()
    vi.restoreAllMocks()
    mockFetch(url => url.href === 'https://github.com/login/oauth/access_token' ? json({ error: 'bad_refresh_token' }) : undefined)
    await expect(userToken(env, id)).rejects.toThrow()
    expect(await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind(id).first()).toBeNull()
  })
})

describe('safeNext', () => {
  it.each([
    [undefined, '/plugins'],
    ['/plugins/demo', '/plugins/demo'],
    ['//evil.example', '/plugins'],
    ['/\\evil.example', '/plugins'],
    ['https://evil.example', '/plugins'],
    ['/api/auth/logout', '/plugins'],
  ])('%s gives %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected)
  })
})
