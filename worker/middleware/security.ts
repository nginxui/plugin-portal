import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'

export const REQUEST_HEADER = 'X-Portal-Request'

const SAFE_METHODS = new Set(['GET', 'HEAD'])

// Sibling subdomains of nginxui.com are the same site, so SameSite cookies do
// not stop them. Every mutating call needs our exact Origin and a custom
// header, and no preflight is ever answered, so no other origin can send one.
export const security: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'OPTIONS')
    return c.json({ error: 'method_not_allowed' }, 405)
  if (!SAFE_METHODS.has(c.req.method) && !c.req.path.startsWith('/api/hooks/')) {
    if (c.req.header('Origin') !== c.env.PORTAL_ORIGIN || c.req.header(REQUEST_HEADER) !== '1')
      return c.json({ error: 'forbidden_origin' }, 403)
  }
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
}
