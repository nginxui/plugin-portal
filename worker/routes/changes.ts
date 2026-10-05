import type { AppEnv, Env, Session } from '../env'
import type { ChangeRow } from '../lib/changes'
import { Hono } from 'hono'
import { mapLimit, repoAccess } from '../lib/access'
import { audit } from '../lib/audit'
import { botEnabled, botToken } from '../lib/bot'
import { cached } from '../lib/cache'
import { loadCatalog } from '../lib/catalog'
import { event, getChange } from '../lib/changes'
import { dispatchApply, dispatchDeploy } from '../lib/deployApp'
import { github } from '../lib/github'
import { userToken } from '../lib/session'
import { headOf } from '../lib/store'
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
// A store change that went to the author's repository: merged once its pull
// request is, or once the default branch holds the document by hand.
async function refreshRepoStore(env: Env, token: string, change: ChangeRow): Promise<ChangeRow> {
  const payload = JSON.parse(change.payload_json ?? '{}') as { repo?: string, delivery?: string, repo_doc?: unknown }
  if (!payload.repo)
    return change
  const t = now()
  let commit: string | null = null
  if (payload.delivery === 'bot' && change.pr_number) {
    const pr = await github<PullResponse>(`/repos/${payload.repo}/pulls/${change.pr_number}`, token)
    if (!pr.merged && pr.state === 'closed') {
      await env.DB.batch([
        env.DB.prepare(`UPDATE changes SET state = 'withdrawn', waiting_on = NULL, updated_at = ? WHERE id = ?`).bind(t, change.id),
        event(env, change.id, 'withdrawn', null, { reason: 'pull_request_closed' }),
      ])
      return { ...change, state: 'withdrawn', waiting_on: null }
    }
    commit = pr.merged ? pr.merge_commit_sha : null
  }
  else if (payload.delivery === 'patch') {
    const head = await headOf(token, payload.repo).catch(() => null)
    if (head) {
      const response = await fetch(`https://raw.githubusercontent.com/${payload.repo}/${head.sha}/plugin.store.json`)
      const text = response.ok ? await response.text() : ''
      try {
        const { $schema: _, ...doc } = JSON.parse(text) as Record<string, unknown>
        if (JSON.stringify(doc) === JSON.stringify(payload.repo_doc))
          commit = head.sha
      }
      catch {}
    }
  }
  if (!commit)
    return change
  await env.DB.batch([
    env.DB.prepare(`UPDATE changes SET state = 'merged', stage = 'merged', waiting_on = 'system', commit_sha = ?, updated_at = ? WHERE id = ?`).bind(commit, t, change.id),
    event(env, change.id, 'merged', null, { commit, repo: payload.repo }),
    env.DB.prepare(`UPDATE suggestions SET state = 'merged' WHERE change_id = ? AND state = 'accepted'`).bind(change.id),
  ])
  // The catalog reads the repository at its next build; start one now.
  await dispatchDeploy(env).catch(error => console.error('deploy dispatch failed', error))
  return { ...change, state: 'merged', stage: 'merged', waiting_on: 'system', commit_sha: commit }
}

export async function refresh(env: Env, token: string, change: ChangeRow): Promise<ChangeRow> {
  if (change.state !== 'open' && change.state !== 'merged')
    return change
  if ((change.kind === 'store' || change.kind === 'translations') && change.state === 'open' && change.stage === 'review' && change.waiting_on === 'author')
    return refreshRepoStore(env, token, change)
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

// Where a store change went: the author's repository by a pull request of
// the bot or a patch, or the catalog; and its items.
function storeRequest(env: Env, change: ChangeRow) {
  if ((change.kind !== 'store' && change.kind !== 'translations') || !change.payload_json)
    return {}
  const payload = JSON.parse(change.payload_json) as {
    delivery?: string
    pr_url?: string
    repo?: string
    items?: { field: string, locale?: string, label: string, review: boolean }[]
    doc?: { name?: Record<string, string>, description?: Record<string, string>, screenshots?: { id: string, caption?: Record<string, string> }[], permission_reasons?: Record<string, Record<string, string>> }
  }
  const repoPr = payload.delivery === 'bot' && payload.pr_url
  // The new text of a name or a caption, short enough to show in a row.
  const valueOf = (item: { field: string, locale?: string, label: string }) => {
    const doc = payload.doc
    if (item.field === 'permission_reasons' && item.locale)
      return payload.doc?.permission_reasons?.[item.label.split('.').slice(2).join('.')]?.[item.locale]
    if (!doc || !item.locale)
      return undefined
    if (item.field === 'name')
      return doc.name?.[item.locale]
    if (item.field === 'caption')
      return doc.screenshots?.find(s => s.id === item.label.split('.')[1])?.caption?.[item.locale]
    return undefined
  }
  return {
    delivery: payload.delivery ?? null,
    repo: payload.repo ?? null,
    items: (payload.items ?? []).map(item => ({ ...item, value: valueOf(item)?.slice(0, 80) })),
    ...(repoPr ? { prUrl: payload.pr_url } : {}),
    ...(payload.delivery === 'patch' ? { patchUrl: `/api/changes/${change.id}/patch` } : {}),
  }
}

export function present(env: Env, change: ChangeRow) {
  return {
    id: change.id,
    number: change.number,
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
    ...storeRequest(env, change),
    outcome: change.outcome_json ? JSON.parse(change.outcome_json) : null,
    createdAt: change.created_at,
    updatedAt: change.updated_at,
  }
}

export const changes = new Hono<AppEnv>()

changes.use('*', requireSession)

changes.get('/', async (c) => {
  const session = c.get('session')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM changes WHERE author_id = ? ORDER BY CASE WHEN state = 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 50`,
  ).bind(session.user.id).all<ChangeRow>()
  // For a reviewed change in progress: how many comments its pull request
  // holds, and what the maintainer asked for last.
  const open = results.filter(row => row.state === 'open' && row.class !== 'self_service')
  const token = open.some(row => row.pr_number) ? await userToken(c.env, session.id).catch(() => '') : ''
  const extra = new Map(await mapLimit(open, 4, async (row) => {
    const [comments, asked] = await Promise.all([
      row.pr_number && token
        ? cached(`pr-comments:${c.env.CATALOG_REPO}:${row.pr_number}`, 300, async () =>
            (await github<{ comments?: number }>(`/repos/${c.env.CATALOG_REPO}/issues/${row.pr_number}`, token).catch(() => null))?.comments ?? null)
        : Promise.resolve(null),
      row.waiting_on === 'author'
        ? c.env.DB.prepare(`SELECT e.detail_json, e.at, u.login FROM change_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.change_id = ? AND e.stage = 'changes_requested' ORDER BY e.at DESC LIMIT 1`).bind(row.id).first<{ detail_json: string | null, at: number, login: string | null }>()
        : Promise.resolve(null),
    ])
    const comment = asked?.detail_json ? (JSON.parse(asked.detail_json) as { comment?: string }).comment : undefined
    return [row.id, { comments, askedFor: typeof comment === 'string' ? comment.slice(0, 300) : null, askedBy: asked?.login ?? null, askedAt: asked?.at ?? null }] as const
  }))
  return c.json({ changes: results.map(row => ({ ...present(c.env, row), ...extra.get(row.id) })) })
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
  const others = await c.env.DB.prepare(
    `SELECT * FROM changes WHERE author_id = ? AND id != ? AND state IN ('open', 'merged') ORDER BY updated_at DESC LIMIT 5`,
  ).bind(session.user.id, change.id).all<ChangeRow>()
  return c.json({
    change: present(c.env, change),
    canRetry: change.author_id === session.user.id && retryable(change),
    canWithdraw: change.author_id === session.user.id && change.state === 'open',
    others: others.results.map(row => present(c.env, row)),
    events: results.map(e => ({ stage: e.stage, actor: e.actor, at: e.at, detail: e.detail_json ? JSON.parse(e.detail_json) : null })),
  })
})

// The author may run the checks again after they failed, or after a
// maintainer asked for changes; the pull request is then updated in place.
function retryable(change: ChangeRow): boolean {
  // A store change in the author's repository is followed, not run again.
  if (change.state !== 'open' || change.kind === 'store' || change.kind === 'translations')
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

// The author withdraws a change still on its way. A pull request of the bot
// on the author's repository is closed by the bot; one in the catalog by
// apply.yml, since only its app may close it.
changes.post('/:id/withdraw', async (c) => {
  const session = c.get('session')
  const change = await getChange(c.env, c.req.param('id'))
  if (!change || change.author_id !== session.user.id)
    return c.json({ error: 'not_found' }, 404)
  if (change.state !== 'open')
    return c.json({ error: 'not_open' }, 409)
  const payload = change.payload_json ? JSON.parse(change.payload_json) as { delivery?: string, repo?: string } : {}
  if ((change.kind === 'store' || change.kind === 'translations') && payload.delivery === 'bot' && change.pr_number && payload.repo && await botEnabled(c.env)) {
    await github(`/repos/${payload.repo}/pulls/${change.pr_number}`, await botToken(c.env), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    }).catch(error => console.error('closing the pull request failed', error))
  }
  else if (change.pr_number && change.stage === 'review') {
    await dispatchApply(c.env, change.id, { kind: 'close', pr_number: change.pr_number, submitter: { login: session.user.login, id: session.user.id } })
      .catch(error => console.error('dispatch failed', error))
  }
  const t = now()
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE changes SET state = 'withdrawn', waiting_on = NULL, updated_at = ? WHERE id = ?`).bind(t, change.id),
    event(c.env, change.id, 'withdrawn', session.user.id),
    c.env.DB.prepare(`UPDATE suggestions SET change_id = NULL WHERE change_id = ? AND state = 'accepted'`).bind(change.id),
  ])
  await audit(c.env.DB, { actorId: session.user.id, action: 'change.withdraw', subject: change.plugin_id ?? undefined, detail: { change: change.id } })
  return c.json({ ok: true })
})
