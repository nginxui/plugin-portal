import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, githubOAuth, json, mockFetch, signIn } from './helpers'

const PR = `/repos/${env.CATALOG_REPO}/pulls/12`
let calls: { method: string, path: string, body: unknown }[] = []
let mergeStatus = 200

function pullRoutes(): Route[] {
  return [
    async (url, init) => {
      const ours = url.pathname.startsWith(PR) || url.pathname.startsWith(`/repos/${env.CATALOG_REPO}/issues/12`) || url.pathname.includes('/check-runs')
      if (url.hostname !== 'api.github.com' || !ours)
        return undefined
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(await new Response(init.body).text()) : null
      calls.push({ method, path: url.pathname, body })
      if (url.pathname === PR && method === 'GET')
        return json({ number: 12, state: 'open', merged: false, mergeable: true, mergeable_state: 'clean', html_url: 'https://github.com/x/pull/12', title: 'feat(plugins): list io.github.octo.hello', head: { sha: 'abc123' } })
      if (url.pathname === PR && method === 'PATCH')
        return json({ number: 12, state: 'closed' })
      if (url.pathname === `${PR}/reviews` && method === 'POST')
        return json({ id: 1 })
      if (url.pathname === `${PR}/reviews`)
        return json([{ user: { login: 'someone' }, state: 'COMMENTED', body: 'Looks fine', submitted_at: '2026-10-05T00:00:00Z' }])
      if (url.pathname === `${PR}/merge`)
        return mergeStatus === 200 ? json({ sha: 'def456', merged: true }) : json({ message: 'Base branch was modified' }, mergeStatus)
      if (url.pathname.endsWith('/comments') && method === 'POST')
        return json({ id: 2 })
      if (url.pathname.endsWith('/comments'))
        return json([])
      if (url.pathname.includes('/check-runs'))
        return json({ check_runs: [{ name: 'validate', status: 'completed', conclusion: 'success', html_url: 'https://github.com/x/runs/1' }] })
      return undefined
    },
    url => url.hostname === 'raw.githubusercontent.com' ? new Response('not found', { status: 404 }) : undefined,
  ]
}

async function maintainer() {
  const cookie = await signIn({ push: true })
  vi.restoreAllMocks()
  calls = []
  mergeStatus = 200
  mockFetch(...pullRoutes(), ...githubOAuth({ push: true }))
  return cookie
}

async function seedChange(kind = 'new_listing') {
  const t = Math.floor(Date.now() / 1000)
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id, login, created_at, last_seen_at) VALUES (77, 'octo', ?, ?)`).bind(t, t),
    env.DB.prepare(`INSERT INTO plugins (plugin_id, repo_full_name, state, created_by, created_at, updated_at) VALUES ('io.github.octo.hello', 'octo/hello', 'draft', 77, ?, ?)`).bind(t, t),
    env.DB.prepare(
      `INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, waiting_on, pr_number, created_at, updated_at)
       VALUES ('c_review00000001', 'io.github.octo.hello', 77, ?, 'reviewed', 'open', 'review', 'maintainer', 12, ?, ?)`,
    ).bind(kind, t, t),
  ])
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('review', () => {
  it('is for maintainers only', async () => {
    const cookie = await signIn()
    expect((await call('/api/review/queue', { cookie })).status).toBe(403)
  })

  it('queues changes waiting on a maintainer first', async () => {
    const cookie = await maintainer()
    await seedChange()
    const body = await (await call('/api/review/queue', { cookie })).json() as { changes: { id: string, author: string, risk: string, repo: string }[] }
    expect(body.changes).toEqual([expect.objectContaining({ id: 'c_review00000001', author: 'octo', risk: 'high', repo: 'octo/hello' })])
  })

  it('shows the pull request, its checks and conversation', async () => {
    const cookie = await maintainer()
    await seedChange()
    const body = await (await call('/api/review/c_review00000001', { cookie })).json() as { pull: { mergeable: boolean }, checks: { conclusion: string }[], conversation: { body: string }[], before: unknown }
    expect(body.pull.mergeable).toBe(true)
    expect(body.checks[0].conclusion).toBe('success')
    expect(body.conversation.map(c => c.body)).toEqual(['Looks fine'])
    expect(body.before).toBeNull()
    expect((body as unknown as { author: { login: string, changes: number } }).author).toMatchObject({ login: 'octo', changes: 0 })
  })

  it('approves and squash merges the reviewed commit', async () => {
    const cookie = await maintainer()
    await seedChange()
    const response = await call('/api/review/c_review00000001/approve', { method: 'POST', mutate: true, cookie, json: {} })
    expect(response.status).toBe(200)
    expect(calls.find(c => c.method === 'POST' && c.path.endsWith('/reviews'))?.body).toMatchObject({ event: 'APPROVE', commit_id: 'abc123' })
    expect(calls.find(c => c.path.endsWith('/merge'))?.body).toMatchObject({ merge_method: 'squash', sha: 'abc123' })
    expect(await env.DB.prepare(`SELECT state, stage, commit_sha FROM changes WHERE id = 'c_review00000001'`).first()).toEqual({ state: 'merged', stage: 'merged', commit_sha: 'def456' })
    expect(await env.DB.prepare(`SELECT count(*) AS n FROM audit WHERE action = 'review.merge'`).first()).toEqual({ n: 1 })
  })

  it('keeps the change in review when GitHub refuses the merge', async () => {
    const cookie = await maintainer()
    await seedChange()
    mergeStatus = 409
    const response = await call('/api/review/c_review00000001/approve', { method: 'POST', mutate: true, cookie, json: {} })
    expect(response.status).toBe(409)
    expect(await env.DB.prepare(`SELECT stage FROM changes WHERE id = 'c_review00000001'`).first()).toEqual({ stage: 'review' })
  })

  it('asks the author for changes with a comment', async () => {
    const cookie = await maintainer()
    await seedChange()
    expect((await call('/api/review/c_review00000001/request-changes', { method: 'POST', mutate: true, cookie, json: { comment: ' ' } })).status).toBe(422)
    const response = await call('/api/review/c_review00000001/request-changes', { method: 'POST', mutate: true, cookie, json: { comment: 'Please add a README.' } })
    expect(response.status).toBe(200)
    expect(calls.find(c => c.method === 'POST' && c.path.endsWith('/reviews'))?.body).toMatchObject({ event: 'REQUEST_CHANGES', body: 'Please add a README.' })
    expect(await env.DB.prepare(`SELECT waiting_on FROM changes WHERE id = 'c_review00000001'`).first()).toEqual({ waiting_on: 'author' })
  })

  it('rejects with a reason and closes the pull request', async () => {
    const cookie = await maintainer()
    await seedChange()
    expect((await call('/api/review/c_review00000001/reject', { method: 'POST', mutate: true, cookie, json: {} })).status).toBe(422)
    const response = await call('/api/review/c_review00000001/reject', { method: 'POST', mutate: true, cookie, json: { comment: 'This copies another plugin.' } })
    expect(response.status).toBe(200)
    expect(calls.find(c => c.method === 'POST' && c.path.endsWith('/comments'))?.body).toEqual({ body: 'This copies another plugin.' })
    expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ state: 'closed' })
    expect(await env.DB.prepare(`SELECT state, waiting_on FROM changes WHERE id = 'c_review00000001'`).first()).toEqual({ state: 'rejected', waiting_on: null })
    expect(await env.DB.prepare(`SELECT count(*) AS n FROM audit WHERE action = 'review.reject'`).first()).toEqual({ n: 1 })
  })

  it('approves together only low risk changes', async () => {
    const cookie = await maintainer()
    await seedChange()
    const high = await (await call('/api/review/approve-batch', { method: 'POST', mutate: true, cookie, json: { ids: ['c_review00000001', 'c_missing'] } })).json()
    expect(high).toEqual({ results: { c_review00000001: 'not_low_risk', c_missing: 'not_in_review' } })
    expect(calls.some(c => c.path.endsWith('/merge'))).toBe(false)

    await env.DB.prepare(`UPDATE changes SET kind = 'names' WHERE id = 'c_review00000001'`).run()
    const low = await (await call('/api/review/approve-batch', { method: 'POST', mutate: true, cookie, json: { ids: ['c_review00000001'] } })).json()
    expect(low).toEqual({ results: { c_review00000001: 'merged' } })
    expect((await call('/api/review/approve-batch', { method: 'POST', mutate: true, cookie, json: { ids: [] } })).status).toBe(422)
  })
})
