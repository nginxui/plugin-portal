import type { AppEnv, Env } from '../env'
import type { ChangeRow } from '../lib/changes'
import { Hono } from 'hono'
import { AiError, defaultProvider } from '../lib/ai'
import { preReview, reviewTarget } from '../lib/aiReview'
import { audit } from '../lib/audit'
import { cached } from '../lib/cache'
import { loadCatalog, repoOf } from '../lib/catalog'
import { event, getChange } from '../lib/changes'
import { github, GitHubError } from '../lib/github'
import { isHostLocale } from '../lib/locales'
import { userToken } from '../lib/session'
import { headOf } from '../lib/store'
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
  head: { sha: string, ref: string }
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
  const recent = c.env.DB.prepare(
    `SELECT c.*, u.login AS author_login, NULL AS repo_full_name FROM changes c
     LEFT JOIN users u ON u.id = c.author_id
     WHERE c.class = 'self_service' ORDER BY c.created_at DESC LIMIT 5`,
  ).all<QueueRow>()
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, u.login AS author_login, p.repo_full_name FROM changes c
     LEFT JOIN users u ON u.id = c.author_id
     LEFT JOIN plugins p ON p.plugin_id = c.plugin_id
     WHERE c.state IN ('open', 'merged')
     ORDER BY CASE WHEN c.waiting_on = 'maintainer' THEN 0 ELSE 1 END, c.updated_at ASC LIMIT 200`,
  ).all<QueueRow>()
  // Reviewed changes that reached an end lately.
  const done = await c.env.DB.prepare(
    `SELECT c.*, u.login AS author_login, p.repo_full_name FROM changes c
     LEFT JOIN users u ON u.id = c.author_id
     LEFT JOIN plugins p ON p.plugin_id = c.plugin_id
     WHERE c.class != 'self_service' AND c.state IN ('live', 'rejected', 'withdrawn') ORDER BY c.updated_at DESC LIMIT 50`,
  ).all<QueueRow>()
  return c.json({
    changes: results.map(row => ({
      ...present(c.env, row),
      author: row.author_login,
      repo: row.repo_full_name,
      risk: risk(row),
    })),
    recent: (await recent).results.map(row => ({ ...present(c.env, row), author: row.author_login })),
    done: done.results.map(row => ({ ...present(c.env, row), author: row.author_login, repo: row.repo_full_name, risk: risk(row) })),
  })
})

// Every plugin of the catalog and those still in review, for the command
// palette.
review.get('/catalog', async (c) => {
  const [catalog, drafts] = await Promise.all([
    loadCatalog(c.env),
    c.env.DB.prepare(`SELECT plugin_id, repo_full_name, state FROM plugins WHERE state != 'listed'`).all<{ plugin_id: string, repo_full_name: string | null, state: string }>(),
  ])
  const listed = catalog.plugins.map(p => ({
    id: p.id,
    name: p.name,
    owner: repoOf(p.repository_url)?.split('/')[0] ?? null,
    state: 'listed',
    yanked: !!p.releases?.length && p.releases.every(r => r.yanked),
  }))
  const known = new Set(listed.map(p => p.id))
  const pending = drafts.results.filter(row => !known.has(row.plugin_id)).map(row => ({
    id: row.plugin_id,
    name: null,
    owner: row.repo_full_name?.split('/')[0] ?? null,
    state: row.state,
    yanked: false,
  }))
  return c.json({ plugins: [...listed, ...pending] })
})

// The repository and ref a change is read at: the release a new listing was
// drafted from, else the listed release, else the default branch.
async function target(env: Env, token: string, change: ChangeRow) {
  const plugin = change.plugin_id ? await env.DB.prepare('SELECT repo_full_name FROM plugins WHERE plugin_id = ?').bind(change.plugin_id).first<{ repo_full_name: string | null }>() : null
  const listing = change.plugin_id ? (await loadCatalog(env)).plugins.find(p => p.id === change.plugin_id) ?? null : null
  const found = reviewTarget(change, plugin?.repo_full_name ?? repoOf(listing?.repository_url) ?? null)
  if (!found.repo || found.ref)
    return found
  const tag = /\/releases\/tag\/([^/?#]+)/.exec(listing?.releases?.[0]?.release_notes_url ?? '')?.[1]
  return { repo: found.repo, ref: tag ? decodeURIComponent(tag) : (await headOf(token, found.repo).catch(() => null))?.sha ?? null }
}

interface AiReviewRow {
  findings_json: string
  provider: string
  model: string
  created_at: number
}

// The AI pre-review of a change in the maintainer's language, if one was made.
review.get('/:id/ai', async (c) => {
  const locale = isHostLocale(c.req.query('locale') ?? '') ? c.req.query('locale')! : 'en'
  const [row, provider] = await Promise.all([
    c.env.DB.prepare('SELECT findings_json, provider, model, created_at FROM ai_reviews WHERE change_id = ? AND locale = ?').bind(c.req.param('id'), locale).first<AiReviewRow>(),
    defaultProvider(c.env),
  ])
  return c.json({
    enabled: !!provider && !!c.env.AI_KEY,
    review: row && { findings: JSON.parse(row.findings_json), provider: row.provider, model: row.model, createdAt: row.created_at },
  })
})

review.post('/:id/ai', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ locale?: string }>().catch(() => ({} as { locale?: string }))
  const locale = isHostLocale(body.locale ?? '') ? body.locale! : 'en'
  const change = await getChange(c.env, c.req.param('id'))
  if (!change)
    return c.json({ error: 'not_found' }, 404)
  const token = await userToken(c.env, session.id)
  const { repo, ref } = await target(c.env, token, change)
  const before = await currentEntry(c.env, change.plugin_id) as Record<string, unknown> | null
  try {
    const result = await preReview(c.env, session.user.id, token, locale, {
      repo,
      ref,
      pluginId: change.plugin_id,
      kind: change.kind,
      entry: change.entry_json ? JSON.parse(change.entry_json) : null,
      before,
    })
    const t = now()
    await c.env.DB.prepare(
      `INSERT INTO ai_reviews (change_id, locale, findings_json, provider, model, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (change_id, locale) DO UPDATE SET findings_json = ?3, provider = ?4, model = ?5, created_by = ?6, created_at = ?7`,
    ).bind(change.id, locale, JSON.stringify(result.findings), result.provider.name, result.provider.model, session.user.id, t).run()
    await audit(c.env.DB, { actorId: session.user.id, action: 'ai.review', subject: change.plugin_id ?? undefined, detail: { change: change.id, findings: result.findings.length, provider: result.provider.name, model: result.provider.model } })
    return c.json({ review: { findings: result.findings, provider: result.provider.name, model: result.provider.model, createdAt: t }, remaining: result.remaining })
  }
  catch (error) {
    if (error instanceof AiError)
      return c.json({ error: error.code }, error.code === 'quota' ? 429 : 503)
    throw error
  }
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
  const listing = change.plugin_id ? (await loadCatalog(c.env)).plugins.find(p => p.id === change.plugin_id) ?? null : null
  const [author, before, history] = await Promise.all([
    c.env.DB.prepare('SELECT login, avatar_url FROM users WHERE id = ?').bind(change.author_id).first<{ login: string, avatar_url: string | null }>(),
    currentEntry(c.env, change.plugin_id),
    c.env.DB.prepare(`SELECT count(*) AS total, sum(CASE WHEN state IN ('merged', 'live') THEN 1 ELSE 0 END) AS merged FROM changes WHERE author_id = ? AND id != ?`)
      .bind(change.author_id, change.id)
      .first<{ total: number, merged: number | null }>(),
  ])
  const payload = change.payload_json ? JSON.parse(change.payload_json) as { eligibility?: string, repository_url?: string } : {}
  // When the repository was created, for the author card.
  const repoName = payload.repository_url?.replace('https://github.com/', '') ?? repoOf(listing?.repository_url) ?? null
  const repoCreatedAt = repoName
    ? await cached(`repo-created:${repoName.toLowerCase()}`, 86400, async () => (await github<{ created_at?: string }>(`/repos/${repoName}`, token).catch(() => null))?.created_at ?? null)
    : null
  const { results: events } = await c.env.DB.prepare(
    `SELECT e.stage, e.detail_json, e.at, u.login AS actor FROM change_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.change_id = ? ORDER BY e.at, e.id`,
  ).bind(change.id).all<{ stage: string, detail_json: string | null, at: number, actor: string | null }>()

  return c.json({
    change: { ...present(c.env, change), risk: risk(change) },
    author: author ? { login: author.login, avatarUrl: author.avatar_url, changes: history?.total ?? 0, merged: history?.merged ?? 0 } : null,
    claim: payload.eligibility ?? null,
    repository: payload.repository_url ?? null,
    repositoryCreatedAt: repoCreatedAt,
    before,
    // The listing as users see it now, for the comparison.
    listing: listing && { description: listing.description ?? null, screenshots: (listing as { screenshots?: unknown[] }).screenshots ?? [], iconUrl: listing.icon_url ?? null, capabilities: listing.capabilities ?? [], manifest: (listing.releases?.[0] as { manifest?: unknown } | undefined)?.manifest ?? null, version: listing.releases?.[0]?.version ?? null },
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
// Keeps the names of some languages as listed: the entry on the pull request
// branch gets them back from main, in a commit by the maintainer, before the
// review and the merge pin the new head.
async function keepNames(env: Env, token: string, change: ChangeRow, pull: Pull, locales: string[]): Promise<Pull> {
  if (!change.plugin_id || !locales.length)
    return pull
  const path = `plugins/${change.plugin_id}.json`
  const file = await github<{ content: string, sha: string }>(`/repos/${env.CATALOG_REPO}/contents/${path}?ref=${encodeURIComponent(pull.head.ref)}`, token)
  const entry = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, '')), ch => ch.charCodeAt(0)))) as { name?: Record<string, string> }
  const listed = await currentEntry(env, change.plugin_id) as { name?: Record<string, string> } | null
  const names = { ...(entry.name ?? {}) }
  for (const locale of locales) {
    if (listed?.name?.[locale])
      names[locale] = listed.name[locale]
    else if (locale !== 'en')
      delete names[locale]
  }
  const next = `${JSON.stringify({ ...entry, name: names }, null, 2)}\n`
  const bytes = new TextEncoder().encode(next)
  let binary = ''
  for (const b of bytes)
    binary += String.fromCharCode(b)
  await github(`/repos/${env.CATALOG_REPO}/contents/${path}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Keep the listed names in ${locales.join(', ')}`, content: btoa(binary), sha: file.sha, branch: pull.head.ref }),
  })
  return github<Pull>(`/repos/${env.CATALOG_REPO}/pulls/${pull.number}`, token)
}

async function approve(env: Env, token: string, actorId: number, id: string, comment: string, onlyLowRisk = false, keep: string[] = []) {
  const found = await openPull(env, token, id)
  if ('error' in found)
    return found
  const { change } = found
  const pull = await keepNames(env, token, change, found.pull, keep.filter(l => /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(l)).slice(0, 20))
  if (onlyLowRisk && (risk(change) === 'high' || change.waiting_on !== 'maintainer'))
    return { error: 'not_low_risk' as const }
  const repo = env.CATALOG_REPO
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
    await env.DB.batch([
      env.DB.prepare(`UPDATE changes SET state = 'merged', stage = 'merged', waiting_on = 'system', commit_sha = ?, updated_at = ? WHERE id = ?`)
        .bind(merged.sha, t, change.id),
      event(env, change.id, 'merged', actorId, { commit: merged.sha }),
    ])
    await audit(env.DB, { actorId, action: 'review.merge', subject: change.plugin_id ?? undefined, detail: { change: change.id, pr: pull.number, commit: merged.sha } })
    return { ok: true as const, commit: merged.sha }
  }
  catch (error) {
    if (error instanceof GitHubError && (error.status === 405 || error.status === 409 || error.status === 422))
      return { error: 'merge_refused' as const, status: error.status }
    throw error
  }
}

review.post('/:id/approve', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const { comment, keepNames: keep } = await c.req.json<{ comment?: string, keepNames?: string[] }>().catch(() => ({ comment: '', keepNames: [] as string[] }))
  const result = await approve(c.env, token, session.user.id, c.req.param('id'), comment ?? '', false, Array.isArray(keep) ? keep : [])
  return result.error ? c.json(result, 409) : c.json(result)
})

const BATCH_LIMIT = 20

// Approves several low risk changes one after another. A change that turned
// high risk or failed to merge is reported and the rest go on.
review.post('/approve-batch', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const { ids } = await c.req.json<{ ids?: unknown }>().catch(() => ({ ids: undefined }))
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > BATCH_LIMIT || !ids.every(id => typeof id === 'string'))
    return c.json({ error: 'invalid_ids' }, 422)
  const results: Record<string, string> = {}
  for (const id of new Set(ids as string[])) {
    const result = await approve(c.env, token, session.user.id, id, '', true)
    results[id] = result.error ?? 'merged'
  }
  return c.json({ results })
})

// Closes the pull request with the reason as its last comment. The author
// cannot resubmit it; a new submission starts a new change.
review.post('/:id/reject', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const found = await openPull(c.env, token, c.req.param('id'))
  if ('error' in found)
    return c.json({ error: found.error }, 409)
  const { change, pull } = found
  const { comment } = await c.req.json<{ comment?: string }>().catch(() => ({ comment: '' }))
  const body = readBody(comment)
  if (!body)
    return c.json({ error: 'comment_required' }, 422)
  const repo = c.env.CATALOG_REPO
  await github(`/repos/${repo}/issues/${pull.number}/comments`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  await github(`/repos/${repo}/pulls/${pull.number}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  })
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE changes SET state = 'rejected', waiting_on = NULL, updated_at = ? WHERE id = ?`).bind(now(), change.id),
    event(c.env, change.id, 'rejected', session.user.id, { comment: body.slice(0, 500) }),
  ])
  await audit(c.env.DB, { actorId: session.user.id, action: 'review.reject', subject: change.plugin_id ?? undefined, detail: { change: change.id, pr: pull.number, reason: body.slice(0, 500) } })
  return c.json({ ok: true })
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
