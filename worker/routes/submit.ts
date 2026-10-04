import type { AppEnv } from '../env'
import { Hono } from 'hono'
import { audit } from '../lib/audit'
import { event, newChangeId } from '../lib/changes'
import { dispatchApply } from '../lib/deployApp'
import { parsePublicKey } from '../lib/rules'
import { userToken } from '../lib/session'
import { knownCategories, previewSubmission } from '../lib/submission'
import { now } from '../lib/time'
import { requireSession } from '../middleware/auth'

export const submit = new Hono<AppEnv>()

submit.use('*', requireSession)

submit.get('/categories', async c => c.json({ categories: await knownCategories(c.env) }))

submit.post('/check', async (c) => {
  const { repo } = await c.req.json<{ repo?: string }>()
  const session = c.get('session')
  const preview = await previewSubmission(c.env, session, await userToken(c.env, session.id), String(repo ?? '').trim())
  return c.json(preview)
})

submit.post('/', async (c) => {
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
      `INSERT INTO changes (id, plugin_id, author_id, kind, class, entry_json, state, stage, waiting_on, payload_json, dispatched_at, created_at, updated_at)
       VALUES (?, ?, ?, 'new_listing', 'reviewed', ?, 'open', 'checks', 'system', ?, ?, ?, ?)`,
    ).bind(id, draft.id, session.user.id, JSON.stringify(draft), JSON.stringify(payload), t, t, t),
    event(c.env, id, 'submitted', session.user.id, { repo: draft.repo, version: draft.version }),
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
