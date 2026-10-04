import type { AppEnv } from '../env'
import { Hono } from 'hono'
import { audit } from '../lib/audit'
import { event, getChange } from '../lib/changes'
import { OidcError, verifyActionsToken } from '../lib/oidc'
import { now } from '../lib/time'

interface ApplyReport {
  change: string
  outcome: 'opened' | 'rejected' | 'checks_failed' | 'unsupported' | 'failed'
  message?: string
  problems?: string
  preview?: string
  class?: string | null
  fields?: unknown[]
  entry?: unknown
  pr_number?: number | null
  run_url?: string
}

const TEXT_LIMIT = 20000

export const hooks = new Hono<AppEnv>()

// Reports of apply.yml, authenticated by the OIDC token of its run.
hooks.post('/apply', async (c) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer /, '') ?? ''
  let claims
  try {
    claims = await verifyActionsToken(token, {
      audience: new URL(c.env.PORTAL_ORIGIN).host,
      repository: c.env.CATALOG_REPO,
      workflow: 'apply.yml',
    })
  }
  catch (error) {
    if (error instanceof OidcError)
      return c.json({ error: 'unauthorized', reason: error.message }, 401)
    throw error
  }

  const report = await c.req.json<ApplyReport>()
  const change = await getChange(c.env, String(report.change ?? ''))
  if (!change)
    return c.json({ error: 'not_found' }, 404)
  // A run started before the latest dispatch reports a superseded attempt.
  if (change.dispatched_at && claims.iat < change.dispatched_at - 5)
    return c.json({ ignored: 'superseded' }, 202)
  if (change.state !== 'open')
    return c.json({ ignored: change.state }, 202)

  const outcome = {
    outcome: report.outcome,
    message: String(report.message ?? '').slice(0, TEXT_LIMIT),
    problems: String(report.problems ?? '').slice(0, TEXT_LIMIT),
    preview: String(report.preview ?? '').slice(0, TEXT_LIMIT),
    runUrl: typeof report.run_url === 'string' && report.run_url.startsWith('https://github.com/') ? report.run_url : null,
    fields: Array.isArray(report.fields) ? report.fields.slice(0, 50) : [],
  }
  const t = now()
  const opened = report.outcome === 'opened' && Number.isSafeInteger(report.pr_number)
  const waitingOn = opened ? 'maintainer' : report.outcome === 'rejected' || report.outcome === 'checks_failed' ? 'author' : 'system'
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE changes SET stage = ?, waiting_on = ?, pr_number = coalesce(?, pr_number), class = coalesce(?, class),
       entry_json = coalesce(?, entry_json), outcome_json = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      opened ? 'review' : 'checks',
      waitingOn,
      opened ? report.pr_number : null,
      report.class === 'reviewed' || report.class === 'maintainer' || report.class === 'self_service' ? report.class : null,
      report.entry ? JSON.stringify(report.entry) : null,
      JSON.stringify(outcome),
      t,
      change.id,
    ),
    event(c.env, change.id, opened ? 'review' : 'checks', null, { outcome: report.outcome, prNumber: opened ? report.pr_number : undefined, runUrl: outcome.runUrl }),
  ])
  await audit(c.env.DB, { actorId: null, action: 'change.applied', subject: change.plugin_id ?? undefined, detail: { change: change.id, outcome: report.outcome, run: claims.run_id } })
  return c.json({ ok: true })
})
