import type { AppEnv } from '../env'
import type { Role } from '../lib/access'
import { Hono } from 'hono'
import { atLeast } from '../lib/access'
import { requireSession } from '../middleware/auth'
import { collectMine } from './plugins'

export const owners = new Hono<AppEnv>()

owners.use('*', requireSession)

// Owners the user works with: themselves and every organization owning a
// plugin repository they have a role on.
owners.get('/', async (c) => {
  const { plugins } = await collectMine(c.env, c.get('session'))
  const byLogin = new Map<string, { login: string, kind: string, avatarUrl: string | null, plugins: number, role: Role | null }>()
  for (const plugin of plugins) {
    if (!plugin.owner)
      continue
    const key = plugin.owner.login.toLowerCase()
    const entry = byLogin.get(key) ?? { login: plugin.owner.login, kind: plugin.owner.kind, avatarUrl: plugin.owner.avatarUrl, plugins: 0, role: null }
    entry.plugins++
    if (plugin.role && (!entry.role || atLeast(plugin.role, entry.role)))
      entry.role = plugin.role
    byLogin.set(key, entry)
  }
  return c.json({ owners: [...byLogin.values()] })
})

// Superseded by the richer route in partners.ts, which lists every plugin of
// the owner with the user's role, none included.
owners.get('/:login/mine', async (c) => {
  const login = c.req.param('login').toLowerCase()
  const { plugins } = await collectMine(c.env, c.get('session'))
  const own = plugins.filter(p => p.owner?.login.toLowerCase() === login)
  if (own.length === 0)
    return c.json({ error: 'not_found' }, 404)
  const owner = own[0].owner!
  // Organization level actions need admin on one of its plugin repositories.
  const isAdmin = own.some(p => p.role === 'admin')
  return c.json({
    owner,
    isAdmin,
    plugins: own,
    accessUrl: owner.kind === 'organization' ? `https://github.com/orgs/${owner.login}/people` : null,
  })
})
