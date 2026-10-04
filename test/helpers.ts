import { env } from 'cloudflare:workers'
import { vi } from 'vitest'
import { app } from '../worker/app'

export type Route = (url: URL, init: RequestInit) => Response | undefined | Promise<Response | undefined>

// Stubs outbound fetch. Each route returns a response or undefined to pass.
export function mockFetch(...routes: Route[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    for (const route of routes) {
      const response = await route(url, { ...init, method: request.method, headers: request.headers })
      if (response)
        return response
    }
    throw new Error(`unexpected fetch ${request.method} ${url}`)
  })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function call(path: string, init: RequestInit & { cookie?: string, mutate?: boolean, json?: unknown } = {}) {
  const headers = new Headers(init.headers)
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    init = { ...init, body: JSON.stringify(init.json) }
  }
  if (init.cookie)
    headers.set('Cookie', init.cookie)
  if (init.mutate) {
    headers.set('Origin', env.PORTAL_ORIGIN)
    headers.set('X-Portal-Request', '1')
  }
  return app.request(path, { ...init, headers }, env)
}

export function cookiesOf(response: Response): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const index = pair.indexOf('=')
    out[pair.slice(0, index)] = pair.slice(index + 1)
  }
  return out
}

export const githubUser = { id: 4242, login: 'octo-author', name: 'Octo Author', avatar_url: 'https://avatars.example/4242' }

export function githubOAuth(options: { push?: boolean } = {}): Route[] {
  return [
    url => url.href === 'https://github.com/login/oauth/access_token'
      ? json({ access_token: 'ghu_access', expires_in: 28800, refresh_token: 'ghr_refresh', refresh_token_expires_in: 15897600 })
      : undefined,
    url => url.href === 'https://api.github.com/user' ? json(githubUser) : undefined,
    url => url.pathname === `/repos/${env.CATALOG_REPO}`
      ? json({ id: 1, full_name: env.CATALOG_REPO, permissions: { pull: true, push: options.push ?? false } })
      : undefined,
  ]
}

// Runs the whole sign in and returns the session cookie header.
export async function signIn(options: { push?: boolean } = {}): Promise<string> {
  const login = await call('/api/auth/login?next=/plugins/demo')
  const oauth = cookiesOf(login)['__Host-oauth']
  const state = new URL(login.headers.get('Location')!).searchParams.get('state')!
  mockFetch(...githubOAuth(options))
  const callback = await call(`/api/auth/callback?code=abc&state=${state}`, { cookie: `__Host-oauth=${oauth}` })
  return `__Host-session=${cookiesOf(callback)['__Host-session']}`
}

// A minisign public key: "Ed", the key id 0x0102030405060708 little endian, 32 key bytes.
const keyBytes = new Uint8Array([0x45, 0x64, 8, 7, 6, 5, 4, 3, 2, 1, ...Array.from({ length: 32 }, (_, i) => i)])
export const publicKey = `untrusted comment: minisign public key 0102030405060708\n${btoa(String.fromCharCode(...keyBytes))}`
