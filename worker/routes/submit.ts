import type { AppEnv } from '../env'
import { Hono } from 'hono'
import { audit } from '../lib/audit'
import { event, newChangeId, NEXT_NUMBER } from '../lib/changes'
import { dispatchApply } from '../lib/deployApp'
import { parsePublicKey } from '../lib/rules'
import { userToken } from '../lib/session'
import { knownCategories, previewSubmission } from '../lib/submission'
import { now } from '../lib/time'
import { requireSession } from '../middleware/auth'
import { limit } from '../middleware/limits'

export const submit = new Hono<AppEnv>()

submit.use('*', requireSession)

submit.get('/categories', async c => c.json({ categories: await knownCategories(c.env) }))

// Submissions started and not sent yet, kept with the account.
const REPO = /^[A-Z0-9][A-Z0-9-]{0,38}\/(?!\.{1,2}$)[\w.-]{1,100}$/i

interface DraftRow {
  repo_full_name: string
  plugin_id: string | null
  name_json: string | null
  step: number
  problem_json: string | null
  public_key: string | null
  categories_json: string | null
  updated_at: number
}

submit.get('/drafts', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM submit_drafts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10')
    .bind(c.get('session').user.id)
    .all<DraftRow>()
  return c.json({
    drafts: results.map(row => ({
      repo: row.repo_full_name,
      id: row.plugin_id,
      name: row.name_json ? JSON.parse(row.name_json) : {},
      step: row.step,
      at: row.updated_at,
      problem: row.problem_json ? JSON.parse(row.problem_json) : null,
      publicKey: row.public_key ?? '',
      categories: row.categories_json ? JSON.parse(row.categories_json) : [],
    })),
  })
})

submit.put('/drafts', async (c) => {
  const body = await c.req.json<{ repo?: string, id?: string | null, name?: unknown, step?: number, problem?: unknown, publicKey?: string, categories?: unknown }>().catch(() => ({} as Record<string, never>))
  const repo = String(body.repo ?? '')
  if (!REPO.test(repo))
    return c.json({ error: 'invalid' }, 422)
  const name = body.name && typeof body.name === 'object' ? JSON.stringify(body.name).slice(0, 4000) : null
  const problem = body.problem && typeof body.problem === 'object' ? JSON.stringify(body.problem).slice(0, 2000) : null
  const categories = Array.isArray(body.categories) ? JSON.stringify(body.categories.map(String).slice(0, 3)) : null
  const step = Math.max(1, Math.min(4, Math.floor(Number(body.step) || 1)))
  await c.env.DB.prepare(
    `INSERT INTO submit_drafts (user_id, repo_full_name, plugin_id, name_json, step, problem_json, public_key, categories_json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT (user_id, repo_full_name) DO UPDATE SET plugin_id = ?3, name_json = ?4, step = ?5, problem_json = ?6, public_key = coalesce(?7, public_key), categories_json = coalesce(?8, categories_json), updated_at = ?9`,
  ).bind(c.get('session').user.id, repo, typeof body.id === 'string' ? body.id.slice(0, 64) : null, name, step, problem, typeof body.publicKey === 'string' ? body.publicKey.slice(0, 400) : null, categories, now()).run()
  return c.json({ ok: true })
})

submit.delete('/drafts', async (c) => {
  await c.env.DB.prepare('DELETE FROM submit_drafts WHERE user_id = ? AND repo_full_name = ?').bind(c.get('session').user.id, c.req.query('repo') ?? '').run()
  return c.json({ ok: true })
})

submit.post('/check', limit('check'), async (c) => {
  const { repo } = await c.req.json<{ repo?: string }>()
  const session = c.get('session')
  const preview = await previewSubmission(c.env, session, await userToken(c.env, session.id), String(repo ?? '').trim())
  return c.json(preview)
})

submit.post('/', limit('write'), async (c) => {
  const body = await c.req.json<{ repo?: string, authorPublicKey?: string, categories?: string[] }>()
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const preview = await previewSubmission(c.env, session, token, String(body.repo ?? '').trim())
  if (!preview.ok || !preview.draft)
    return c.json({ error: 'checks_failed', preview }, 422)
  const key = parsePublicKey(String(body.authorPublicKey ?? ''))
  if (!key)
    return c.json({ error: 'invalid_key' }, 422)
  const known = await knownCategories(c.env)
  const categories = Array.isArray(body.categories) ? body.categories.map(String) : []
  if (categories.length > 3 || categories.some(item => !known.includes(item)))
    return c.json({ error: 'invalid_categories' }, 422)

  const draft = preview.draft
  const id = newChangeId()
  const t = now()
  const payload = {
    kind: 'new_listing',
    repository_url: `https://github.com/${draft.repo}`,
    author_public_key: key.line,
    categories,
    submitter: { login: session.user.login, id: session.user.id },
    eligibility: preview.claim,
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO plugins (plugin_id, repo_full_name, state, created_by, created_at, updated_at) VALUES (?1, ?2, 'draft', ?3, ?4, ?4)
       ON CONFLICT (plugin_id) DO UPDATE SET repo_full_name = ?2, updated_at = ?4 WHERE state = 'draft'`,
    ).bind(draft.id, draft.repo, session.user.id, t),
    c.env.DB.prepare(
      `INSERT INTO changes (number, id, plugin_id, author_id, kind, class, entry_json, state, stage, waiting_on, payload_json, dispatched_at, created_at, updated_at)
       VALUES (${NEXT_NUMBER}, ?, ?, ?, 'new_listing', 'reviewed', ?, 'open', 'checks', 'system', ?, ?, ?, ?)`,
    ).bind(id, draft.id, session.user.id, JSON.stringify(draft), JSON.stringify(payload), t, t, t),
    event(c.env, id, 'submitted', session.user.id, { repo: draft.repo, version: draft.version }),
    c.env.DB.prepare('DELETE FROM submit_drafts WHERE user_id = ? AND repo_full_name = ?').bind(session.user.id, draft.repo),
  ])
  try {
    await dispatchApply(c.env, id, payload)
  }
  catch (error) {
    console.error('dispatch failed', error)
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE changes SET waiting_on = 'system', outcome_json = ? WHERE id = ?`)
        .bind(JSON.stringify({ outcome: 'dispatch_failed' }), id),
      event(c.env, id, 'checks', null, { outcome: 'dispatch_failed' }),
    ])
  }
  await audit(c.env.DB, { actorId: session.user.id, action: 'change.submit', subject: draft.id, detail: { change: id, repo: draft.repo } })
  return c.json({ change: id }, 201)
})
