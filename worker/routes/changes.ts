import type { AppEnv, Env, Session } from '../env'
import type { ChangeRow } from '../lib/changes'
import { Hono } from 'hono'
import { repoAccess } from '../lib/access'
import { loadCatalog } from '../lib/catalog'
import { event, getChange } from '../lib/changes'
import { dispatchApply } from '../lib/deployApp'
import { github } from '../lib/github'
import { userToken } from '../lib/session'
import { now } from '../lib/time'
import { checkMaintainer, requireSession } from '../middleware/auth'

interface PullResponse {
  state: 'open' | 'closed'
  merged: boolean
  merge_commit_sha: string | null
  merged_at: string | null
}

// Moves a change along by what GitHub and the published catalog say now:
// its pull request merged or closed, its plugin in the index.
export async function refresh(env: Env, token: string, change: ChangeRow): Promise<ChangeRow> {
  if (change.state !== 'open' && change.state !== 'merged')
    return change
  const t = now()
  if (change.stage === 'review' && change.pr_number) {
    const pr = await github<PullResponse>(`/repos/${env.CATALOG_REPO}/pulls/${change.pr_number}`, token)
    if (pr.merged) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE changes SET state = 'merged', stage = 'merged', waiting_on = 'system', commit_sha = ?, updated_at = ? WHERE id = ?`)
          .bind(pr.merge_commit_sha, t, change.id),
        event(env, change.id, 'merged', null, { commit: pr.merge_commit_sha }),
      ])
      change = { ...change, state: 'merged', stage: 'merged', waiting_on: 'system', commit_sha: pr.merge_commit_sha }
    }
    else if (pr.state === 'closed') {
      await env.DB.batch([
        env.DB.prepare(`UPDATE changes SET state = 'rejected', waiting_on = NULL, updated_at = ? WHERE id = ?`).bind(t, change.id),
        event(env, change.id, 'rejected', null),
      ])
      return { ...change, state: 'rejected', waiting_on: null }
    }
  }
  // The deploy report moves changes to live; for a new listing the index is
  // a fallback when a report was missed.
  if (change.stage === 'merged' && change.plugin_id && change.kind === 'new_listing') {
    const catalog = await loadCatalog(env)
    if (catalog.plugins.some(p => p.id === change.plugin_id)) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE changes SET state = 'live', stage = 'live', waiting_on = NULL, deployed_at = ?, updated_at = ? WHERE id = ?`)
          .bind(t, t, change.id),
        env.DB.prepare(`UPDATE plugins SET state = 'listed', updated_at = ? WHERE plugin_id = ?`).bind(t, change.plugin_id),
        event(env, change.id, 'live', null),
      ])
      change = { ...change, state: 'live', stage: 'live', waiting_on: null, deployed_at: t }
    }
  }
  return change
}

// The author, anyone with a role on the plugin's repository and maintainers.
async function canSee(env: Env, session: Session, token: string, change: ChangeRow): Promise<boolean> {
  if (change.author_id === session.user.id)
    return true
  const repo = change.plugin_id
    ? (await env.DB.prepare('SELECT repo_full_name FROM plugins WHERE plugin_id = ?').bind(change.plugin_id).first<{ repo_full_name: string | null }>())?.repo_full_name
    : null
  if (repo && (await repoAccess(env, session.user.id, token, repo)).role)
    return true
  return checkMaintainer(env, session.id)
}

function selfServiceRequest(payload: string | null): { operations?: Record<string, string[]>, reason?: string } {
  if (!payload)
    return {}
  const parsed = JSON.parse(payload) as { kind?: string, operations?: Record<string, string[]>, reason?: string }
  return parsed.kind === 'entry_update' ? { operations: parsed.operations, reason: parsed.reason || undefined } : {}
}

export function present(env: Env, change: ChangeRow) {
  return {
    id: change.id,
    pluginId: change.plugin_id,
    kind: change.kind,
    class: change.class,
    state: change.state,
    stage: change.stage,
    waitingOn: change.waiting_on,
    prNumber: change.pr_number,
    prUrl: change.pr_number ? `https://github.com/${env.CATALOG_REPO}/pull/${change.pr_number}` : null,
    commitSha: change.commit_sha,
    commitUrl: change.commit_sha ? `https://github.com/${env.CATALOG_REPO}/commit/${change.commit_sha}` : null,
    entry: change.entry_json ? JSON.parse(change.entry_json) : null,
    // What a self service change asked for, as the author sent it.
    ...selfServiceRequest(change.payload_json),
    outcome: change.outcome_json ? JSON.parse(change.outcome_json) : null,
    createdAt: change.created_at,
    updatedAt: change.updated_at,
  }
}

export const changes = new Hono<AppEnv>()

changes.use('*', requireSession)

changes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM changes WHERE author_id = ? ORDER BY CASE WHEN state = 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 50`,
  ).bind(c.get('session').user.id).all<ChangeRow>()
  return c.json({ changes: results.map(row => present(c.env, row)) })
})

changes.get('/:id', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const found = await getChange(c.env, c.req.param('id'))
  if (!found || !await canSee(c.env, session, token, found))
    return c.json({ error: 'not_found' }, 404)
  const change = await refresh(c.env, token, found)
  const { results } = await c.env.DB.prepare(
    `SELECT e.stage, e.detail_json, e.at, u.login AS actor FROM change_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.change_id = ? ORDER BY e.at, e.id`,
  ).bind(change.id).all<{ stage: string, detail_json: string | null, at: number, actor: string | null }>()
  return c.json({
    change: present(c.env, change),
    canRetry: change.author_id === session.user.id && retryable(change),
    events: results.map(e => ({ stage: e.stage, actor: e.actor, at: e.at, detail: e.detail_json ? JSON.parse(e.detail_json) : null })),
  })
})

// The author may run the checks again after they failed, or after a
// maintainer asked for changes; the pull request is then updated in place.
function retryable(change: ChangeRow): boolean {
  if (change.state !== 'open')
    return false
  return (change.stage === 'checks' && change.waiting_on !== null) || (change.stage === 'review' && change.waiting_on === 'author')
}

// Runs apply.yml again for a change whose checks failed, with the newest
// release of the repository.
changes.post('/:id/retry', async (c) => {
  const session = c.get('session')
  const change = await getChange(c.env, c.req.param('id'))
  if (!change || change.author_id !== session.user.id)
    return c.json({ error: 'not_found' }, 404)
  if (!retryable(change) || !change.payload_json)
    return c.json({ error: 'not_retryable' }, 409)
  const t = now()
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE changes SET stage = 'checks', waiting_on = 'system', dispatched_at = ?, outcome_json = NULL, updated_at = ? WHERE id = ?`).bind(t, t, change.id),
    event(c.env, change.id, 'submitted', session.user.id, { retry: true }),
  ])
  await dispatchApply(c.env, change.id, JSON.parse(change.payload_json))
  return c.json({ ok: true })
})
