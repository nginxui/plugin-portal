import type { AppEnv, Env } from '../env'
import type { ChangeRow } from '../lib/changes'
import { Hono } from 'hono'
import { audit } from '../lib/audit'
import { event, getChange } from '../lib/changes'
import { github, GitHubError } from '../lib/github'
import { userToken } from '../lib/session'
import { now } from '../lib/time'
import { requireMaintainer, requireSession } from '../middleware/auth'
import { present, refresh } from './changes'

// The maintainer side of a change: the queue, what a change does, and acting
// on its pull request with the maintainer's own token, so GitHub records the
// review and the merge under their name.

interface QueueRow extends ChangeRow {
  author_login: string | null
  repo_full_name: string | null
}

interface Pull {
  number: number
  state: 'open' | 'closed'
  merged: boolean
  mergeable: boolean | null
  mergeable_state: string
  html_url: string
  title: string
  head: { sha: string }
}

interface Review {
  user: { login: string } | null
  state: string
  body: string
  submitted_at: string
}

interface Comment {
  user: { login: string } | null
  body: string
  created_at: string
}

interface CheckRuns {
  check_runs: { name: string, status: string, conclusion: string | null, html_url: string }[]
}

const COMMENT_LIMIT = 4000

// A new listing or a new key gets the closest look; a name change less.
export function risk(change: Pick<ChangeRow, 'kind' | 'class' | 'outcome_json'>): 'high' | 'normal' {
  if (change.kind === 'new_listing' || change.class === 'maintainer')
    return 'high'
  const fields = change.outcome_json ? (JSON.parse(change.outcome_json).fields ?? []) as { field: string }[] : []
  return fields.some(f => f.field === 'author_public_key' || f.field === 'repository_url') ? 'high' : 'normal'
}

async function currentEntry(env: Env, pluginId: string | null): Promise<unknown | null> {
  if (!pluginId)
    return null
  const response = await fetch(`https://raw.githubusercontent.com/${env.CATALOG_REPO}/main/plugins/${pluginId}.json`)
  return response.ok ? response.json() : null
}

export const review = new Hono<AppEnv>()

review.use('*', requireSession, requireMaintainer)

review.get('/queue', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, u.login AS author_login, p.repo_full_name FROM changes c
     LEFT JOIN users u ON u.id = c.author_id
     LEFT JOIN plugins p ON p.plugin_id = c.plugin_id
     WHERE c.state IN ('open', 'merged')
     ORDER BY CASE WHEN c.waiting_on = 'maintainer' THEN 0 ELSE 1 END, c.updated_at ASC LIMIT 200`,
  ).all<QueueRow>()
  return c.json({
    changes: results.map(row => ({
      ...present(c.env, row),
      author: row.author_login,
      repo: row.repo_full_name,
      risk: risk(row),
    })),
  })
})

review.get('/:id', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const found = await getChange(c.env, c.req.param('id'))
  if (!found)
    return c.json({ error: 'not_found' }, 404)
  const change = await refresh(c.env, token, found)
  const repo = c.env.CATALOG_REPO

  let pull: Pull | null = null
  let reviews: Review[] = []
  let comments: Comment[] = []
  let checks: CheckRuns['check_runs'] = []
  if (change.pr_number) {
    pull = await github<Pull>(`/repos/${repo}/pulls/${change.pr_number}`, token)
    ;[reviews, comments, checks] = await Promise.all([
      github<Review[]>(`/repos/${repo}/pulls/${change.pr_number}/reviews?per_page=100`, token).catch(() => []),
      github<Comment[]>(`/repos/${repo}/issues/${change.pr_number}/comments?per_page=100`, token).catch(() => []),
      github<CheckRuns>(`/repos/${repo}/commits/${pull.head.sha}/check-runs?per_page=50`, token).then(r => r.check_runs).catch(() => []),
    ])
  }
  const [author, before, history] = await Promise.all([
    c.env.DB.prepare('SELECT login, avatar_url FROM users WHERE id = ?').bind(change.author_id).first<{ login: string, avatar_url: string | null }>(),
    currentEntry(c.env, change.plugin_id),
    c.env.DB.prepare(`SELECT count(*) AS total, sum(CASE WHEN state IN ('merged', 'live') THEN 1 ELSE 0 END) AS merged FROM changes WHERE author_id = ? AND id != ?`)
      .bind(change.author_id, change.id)
      .first<{ total: number, merged: number | null }>(),
  ])
  const payload = change.payload_json ? JSON.parse(change.payload_json) as { eligibility?: string, repository_url?: string } : {}
  const { results: events } = await c.env.DB.prepare(
    `SELECT e.stage, e.detail_json, e.at, u.login AS actor FROM change_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.change_id = ? ORDER BY e.at, e.id`,
  ).bind(change.id).all<{ stage: string, detail_json: string | null, at: number, actor: string | null }>()

  return c.json({
    change: { ...present(c.env, change), risk: risk(change) },
    author: author ? { login: author.login, avatarUrl: author.avatar_url, changes: history?.total ?? 0, merged: history?.merged ?? 0 } : null,
    claim: payload.eligibility ?? null,
    repository: payload.repository_url ?? null,
    before,
    pull: pull && {
      number: pull.number,
      state: pull.state,
      merged: pull.merged,
      mergeable: pull.mergeable,
      mergeableState: pull.mergeable_state,
      url: pull.html_url,
      title: pull.title,
    },
    checks: checks.map(r => ({ name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url })),
    conversation: [
      ...reviews.filter(r => r.body || r.state !== 'COMMENTED').map(r => ({ kind: 'review', state: r.state, author: r.user?.login ?? null, body: r.body, at: r.submitted_at })),
      ...comments.map(r => ({ kind: 'comment', state: null, author: r.user?.login ?? null, body: r.body, at: r.created_at })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
    events: events.map(e => ({ stage: e.stage, actor: e.actor, at: e.at, detail: e.detail_json ? JSON.parse(e.detail_json) : null })),
  })
})

async function openPull(env: Env, token: string, id: string) {
  const change = await getChange(env, id)
  if (!change || change.state !== 'open' || change.stage !== 'review' || !change.pr_number)
    return { error: 'not_in_review' as const }
  const pull = await github<Pull>(`/repos/${env.CATALOG_REPO}/pulls/${change.pr_number}`, token)
  if (pull.state !== 'open')
    return { error: 'not_in_review' as const }
  return { change, pull }
}

function readBody(text: unknown): string {
  return String(text ?? '').trim().slice(0, COMMENT_LIMIT)
}

// Approves and squash merges the pull request as the maintainer. The head sha
// pins the merge to the commit that was reviewed.
review.post('/:id/approve', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const found = await openPull(c.env, token, c.req.param('id'))
  if ('error' in found)
    return c.json({ error: found.error }, 409)
  const { change, pull } = found
  const { comment } = await c.req.json<{ comment?: string }>().catch(() => ({ comment: '' }))
  const repo = c.env.CATALOG_REPO
  try {
    await github(`/repos/${repo}/pulls/${pull.number}/reviews`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'APPROVE', commit_id: pull.head.sha, body: readBody(comment) || undefined }),
    })
    const merged = await github<{ sha: string }>(`/repos/${repo}/pulls/${pull.number}/merge`, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: 'squash', sha: pull.head.sha, commit_title: `${pull.title} (#${pull.number})` }),
    })
    const t = now()
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE changes SET state = 'merged', stage = 'merged', waiting_on = 'system', commit_sha = ?, updated_at = ? WHERE id = ?`)
        .bind(merged.sha, t, change.id),
      event(c.env, change.id, 'merged', session.user.id, { commit: merged.sha }),
    ])
    await audit(c.env.DB, { actorId: session.user.id, action: 'review.merge', subject: change.plugin_id ?? undefined, detail: { change: change.id, pr: pull.number, commit: merged.sha } })
    return c.json({ ok: true, commit: merged.sha })
  }
  catch (error) {
    if (error instanceof GitHubError && (error.status === 405 || error.status === 409 || error.status === 422))
      return c.json({ error: 'merge_refused', status: error.status }, 409)
    throw error
  }
})

// Asks the author for changes; they resubmit from their change page.
review.post('/:id/request-changes', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const found = await openPull(c.env, token, c.req.param('id'))
  if ('error' in found)
    return c.json({ error: found.error }, 409)
  const { change, pull } = found
  const { comment } = await c.req.json<{ comment?: string }>()
  const body = readBody(comment)
  if (!body)
    return c.json({ error: 'comment_required' }, 422)
  await github(`/repos/${c.env.CATALOG_REPO}/pulls/${pull.number}/reviews`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'REQUEST_CHANGES', commit_id: pull.head.sha, body }),
  })
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE changes SET waiting_on = 'author', updated_at = ? WHERE id = ?`).bind(now(), change.id),
    event(c.env, change.id, 'changes_requested', session.user.id, { comment: body.slice(0, 500) }),
  ])
  await audit(c.env.DB, { actorId: session.user.id, action: 'review.request_changes', subject: change.plugin_id ?? undefined, detail: { change: change.id, pr: pull.number } })
  return c.json({ ok: true })
})

review.post('/:id/comment', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const found = await openPull(c.env, token, c.req.param('id'))
  if ('error' in found)
    return c.json({ error: found.error }, 409)
  const { comment } = await c.req.json<{ comment?: string }>()
  const body = readBody(comment)
  if (!body)
    return c.json({ error: 'comment_required' }, 422)
  await github(`/repos/${c.env.CATALOG_REPO}/issues/${found.pull.number}/comments`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  return c.json({ ok: true })
})
