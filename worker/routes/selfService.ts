import type { AppEnv } from '../env'
import { Hono } from 'hono'
import { atLeast, repoAccess } from '../lib/access'
import { audit } from '../lib/audit'
import { loadCatalog, repoOf } from '../lib/catalog'
import { event, newChangeId, NEXT_NUMBER } from '../lib/changes'
import { dispatchApply } from '../lib/deployApp'
import { userToken } from '../lib/session'
import { now } from '../lib/time'
import { requireSession } from '../middleware/auth'

// Changes the author of a listed plugin makes alone: yanking and unyanking
// versions, revoking signers and categories. The portal sends the operations;
// apply.yml applies them to the entry on main and commits them once its
// checks pass and the change still classifies as self service.

interface Operations {
  yank?: string[]
  unyank?: string[]
  revoke_signers?: string[]
  categories?: string[]
}

const KIND: Record<keyof Operations, string> = {
  yank: 'yank',
  unyank: 'unyank',
  revoke_signers: 'revoke_signer',
  categories: 'categories',
}

function cleanOperations(input: unknown): Operations | null {
  if (!input || typeof input !== 'object')
    return null
  const out: Operations = {}
  for (const key of Object.keys(KIND) as (keyof Operations)[]) {
    const value = (input as Record<string, unknown>)[key]
    if (value === undefined)
      continue
    if (!Array.isArray(value) || value.length === 0 || value.length > 20 || !value.every(item => typeof item === 'string' && item.length <= 64))
      return null
    out[key] = value as string[]
  }
  // A version cannot be yanked and restored by one change.
  if (out.yank?.some(version => out.unyank?.includes(version)))
    return null
  return Object.keys(out).length ? out : null
}

export const selfService = new Hono<AppEnv>()

selfService.use('*', requireSession)

selfService.post('/:id/changes', async (c) => {
  const session = c.get('session')
  const id = c.req.param('id')
  const body = await c.req.json<{ operations?: unknown, reason?: unknown }>()
  const operations = cleanOperations(body.operations)
  if (!operations)
    return c.json({ error: 'invalid_operations' }, 422)

  const catalog = await loadCatalog(c.env)
  const listed = catalog.plugins.find(p => p.id === id)
  const row = await c.env.DB.prepare('SELECT repo_full_name, state FROM plugins WHERE plugin_id = ?').bind(id).first<{ repo_full_name: string | null, state: string }>()
  const repo = repoOf(listed?.repository_url) ?? (row?.state === 'listed' ? row.repo_full_name : null)
  if (!repo)
    return c.json({ error: 'not_listed' }, 409)

  const token = await userToken(c.env, session.id)
  const access = await repoAccess(c.env, session.user.id, token, repo, true)
  if (!atLeast(access.role, 'publisher'))
    return c.json({ error: 'no_access' }, 403)

  const busy = await c.env.DB.prepare(
    `SELECT id FROM changes WHERE plugin_id = ? AND class = 'self_service' AND state = 'open' LIMIT 1`,
  ).bind(id).first<{ id: string }>()
  if (busy)
    return c.json({ error: 'busy', change: busy.id }, 409)

  // Several operations, or several versions at once, make one batch change.
  const keys = Object.keys(operations) as (keyof Operations)[]
  const kind = keys.length === 1 ? KIND[keys[0]] : 'batch'
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  const change = newChangeId()
  const t = now()
  const payload = {
    kind: 'entry_update',
    plugin_id: id,
    operations,
    reason,
    submitter: { login: session.user.login, id: session.user.id },
    eligibility: `@${session.user.login} has ${access.permission} permission on ${repo}`,
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO changes (number, id, plugin_id, author_id, kind, class, state, stage, waiting_on, payload_json, dispatched_at, created_at, updated_at)
       VALUES (${NEXT_NUMBER}, ?, ?, ?, ?, 'self_service', 'open', 'checks', 'system', ?, ?, ?, ?)`,
    ).bind(change, id, session.user.id, kind, JSON.stringify(payload), t, t, t),
    event(c.env, change, 'submitted', session.user.id, { operations, reason: reason || undefined }),
  ])
  try {
    await dispatchApply(c.env, change, payload)
  }
  catch (error) {
    console.error('dispatch failed', error)
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE changes SET outcome_json = ? WHERE id = ?`).bind(JSON.stringify({ outcome: 'dispatch_failed' }), change),
      event(c.env, change, 'checks', null, { outcome: 'dispatch_failed' }),
    ])
  }
  await audit(c.env.DB, { actorId: session.user.id, action: 'change.self_service', subject: id, detail: { change, operations, reason: reason || undefined } })
  return c.json({ change }, 201)
})
