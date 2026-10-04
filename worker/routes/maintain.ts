import type { AppEnv, Env, Session } from '../env'
import { Hono } from 'hono'
import { mapLimit } from '../lib/access'
import { audit } from '../lib/audit'
import { cached } from '../lib/cache'
import { catalogEntry, loadCatalog, repoOf } from '../lib/catalog'
import { event, newChangeId } from '../lib/changes'
import { dispatchApply } from '../lib/deployApp'
import { github } from '../lib/github'
import { storeSourceOf } from '../lib/insights'
import { keyIdOf, loadPartners } from '../lib/partners'
import { userToken } from '../lib/session'
import { now } from '../lib/time'
import { requireMaintainer, requireSession } from '../middleware/auth'

// Maintainer administration (spec 11.5): every plugin with trust, delisting
// and the block list, and the partners with their requests. Each catalog
// change is a pull request another maintainer can look over.

export const maintain = new Hono<AppEnv>()

maintain.use('*', requireSession, requireMaintainer)

async function blockedList(env: Env) {
  return cached(`blocked:${env.CATALOG_REPO}`, 120, async () => {
    const response = await fetch(`https://raw.githubusercontent.com/${env.CATALOG_REPO}/main/blocked.json`)
    return response.ok ? await response.json() as { plugins: string[], repositories: string[], reasons?: Record<string, { reason: string, added_by?: string, added_at?: string }> } : { plugins: [], repositories: [] }
  })
}

async function maintainerChange(env: Env, session: Session, pluginId: string, kind: string, payload: Record<string, unknown>) {
  const change = newChangeId()
  const t = now()
  const full = { ...payload, kind: 'maintainer_update', plugin_id: pluginId, submitter: { login: session.user.login, id: session.user.id }, eligibility: `@${session.user.login} is a maintainer` }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, waiting_on, payload_json, dispatched_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'maintainer', 'open', 'checks', 'system', ?, ?, ?, ?)`,
    ).bind(change, pluginId, session.user.id, kind, JSON.stringify(full), t, t, t),
    event(env, change, 'submitted', session.user.id, payload),
  ])
  try {
    await dispatchApply(env, change, full)
  }
  catch (error) {
    console.error('dispatch failed', error)
    await env.DB.prepare('UPDATE changes SET outcome_json = ? WHERE id = ?').bind(JSON.stringify({ outcome: 'dispatch_failed' }), change).run()
  }
  return change
}

maintain.get('/plugins', async (c) => {
  const [catalog, drafts, blocked, open, reviews] = await Promise.all([
    loadCatalog(c.env),
    c.env.DB.prepare(`SELECT plugin_id, repo_full_name, owner_id, state, created_at FROM plugins`).all<{ plugin_id: string, repo_full_name: string | null, owner_id: number | null, state: string, created_at: number }>(),
    blockedList(c.env),
    c.env.DB.prepare(`SELECT plugin_id, count(*) AS n FROM changes WHERE state = 'open' AND class != 'self_service' GROUP BY plugin_id`).all<{ plugin_id: string, n: number }>(),
    c.env.DB.prepare(`SELECT avg(e.at - c.created_at) AS seconds, count(*) AS n FROM changes c JOIN change_events e ON e.change_id = c.id AND e.stage = 'merged' WHERE c.kind = 'new_listing' AND c.created_at > ?`).bind(now() - 7 * 86400).first<{ seconds: number | null, n: number }>(),
  ])
  const openBy = new Map(open.results.map(r => [r.plugin_id, r.n]))
  const entries = await mapLimit(catalog.plugins, 6, p => catalogEntry(c.env, p.id))
  const listed = catalog.plugins.map((p, i) => {
    const entry = entries[i]
    const newest = p.releases?.[0]
    const repo = repoOf(p.repository_url)
    return {
      id: p.id,
      name: p.name,
      iconUrl: p.icon_url ?? null,
      owner: repo?.split('/')[0] ?? (p.author ?? null),
      ownerKind: (entry?.distribution as { type?: string } | undefined)?.type === 'vendor' ? 'vendor' : 'github',
      repo,
      trust: p.trust ?? 'community',
      version: newest?.version ?? null,
      source: storeSourceOf(entry?.store),
      state: newest?.yanked ? 'yanked' : openBy.get(p.id) ? 'review' : 'listed',
      openChanges: openBy.get(p.id) ?? 0,
    }
  })
  const known = new Set(listed.map(p => p.id))
  const pending = drafts.results.filter(d => !known.has(d.plugin_id)).map(d => ({
    id: d.plugin_id,
    name: { en: d.plugin_id },
    iconUrl: null,
    owner: d.repo_full_name?.split('/')[0] ?? null,
    ownerKind: d.repo_full_name ? 'github' : 'vendor',
    repo: d.repo_full_name,
    trust: null,
    version: null,
    source: 'release',
    state: d.state === 'delisted' ? 'delisted' : 'review',
    openChanges: openBy.get(d.plugin_id) ?? 0,
  }))
  const plugins = [...listed, ...pending]
  const byTrust = { official: 0, verified: 0, community: 0 } as Record<string, number>
  for (const p of listed)
    byTrust[p.trust] = (byTrust[p.trust] ?? 0) + 1
  return c.json({
    plugins,
    counts: {
      listed: listed.length,
      byTrust,
      newThisWeek: drafts.results.filter(d => d.created_at > now() - 7 * 86400).length,
      reviewHours: reviews?.seconds ? Math.round(reviews.seconds / 3600) : null,
      yanked: listed.filter(p => p.state === 'yanked').length,
      blocked: blocked.plugins.length + blocked.repositories.length,
    },
    blocked: [
      ...blocked.plugins.map(id => ({ kind: 'plugin', value: id, ...(blocked.reasons?.[id] ?? {}) })),
      ...blocked.repositories.map(repo => ({ kind: 'repository', value: repo, ...(blocked.reasons?.[repo] ?? {}) })),
    ],
    blockedUrl: `https://github.com/${c.env.CATALOG_REPO}/blob/main/blocked.json`,
  })
})

maintain.post('/plugins/:id/trust', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ trust?: string, reason?: string }>().catch(() => ({} as Record<string, string>))
  if (!['official', 'verified', 'community'].includes(body.trust ?? '') || !String(body.reason ?? '').trim())
    return c.json({ error: 'invalid' }, 422)
  const id = c.req.param('id')
  const change = await maintainerChange(c.env, session, id, 'trust', { trust: body.trust })
  await audit(c.env.DB, { actorId: session.user.id, action: 'maintain.trust', subject: id, detail: { change, trust: body.trust, reason: String(body.reason).slice(0, 500) } })
  return c.json({ change }, 201)
})

maintain.post('/plugins/:id/delist', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ reason?: string, block?: boolean, repository?: string | null }>().catch(() => ({} as Record<string, never>))
  const reason = String(body.reason ?? '').trim().slice(0, 500)
  if (!reason)
    return c.json({ error: 'invalid' }, 422)
  const id = c.req.param('id')
  const payload = { delist: { reason }, ...(body.block ? { block: { plugin: true, ...(body.repository ? { repository: body.repository } : {}), reason } } : {}) }
  const change = await maintainerChange(c.env, session, id, 'delisting', payload)
  await audit(c.env.DB, { actorId: session.user.id, action: body.block ? 'maintain.block' : 'maintain.delist', subject: id, detail: { change, reason, repository: body.repository ?? null } })
  return c.json({ change }, 201)
})

maintain.post('/blocklist', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ plugin_id?: string, repository?: string, reason?: string }>().catch(() => ({} as Record<string, string>))
  const reason = String(body.reason ?? '').trim().slice(0, 500)
  const id = String(body.plugin_id ?? '').trim()
  if (!reason || (!/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/.test(id) && !body.repository))
    return c.json({ error: 'invalid' }, 422)
  const change = await maintainerChange(c.env, session, id || 'blocked', 'block', { block: { plugin: !!id, ...(body.repository ? { repository: body.repository } : {}), reason } })
  await audit(c.env.DB, { actorId: session.user.id, action: 'maintain.block', subject: id || body.repository, detail: { change, reason } })
  return c.json({ change }, 201)
})

maintain.get('/partners', async (c) => {
  const session = c.get('session')
  const token = await userToken(c.env, session.id)
  const [files, requests, vendors] = await Promise.all([
    loadPartners(c.env, token),
    c.env.DB.prepare(`SELECT r.*, u.login FROM partner_requests r LEFT JOIN users u ON u.id = r.submitted_by WHERE r.state = 'pending' ORDER BY r.created_at`).all<{ id: string, kind: string, owner_login: string | null, vendor_id: number | null, partner: string, payload_json: string, login: string | null, created_at: number }>(),
    c.env.DB.prepare(`SELECT o.id, o.github_login AS slug, o.name, o.partner, (SELECT count(*) FROM plugins p WHERE p.owner_id = o.id) AS plugins FROM owners o WHERE o.kind = 'vendor'`).all<{ id: number, slug: string | null, name: string | null, partner: string | null, plugins: number }>(),
  ])
  const catalog = await loadCatalog(c.env)
  const pluginsOf = (owner: string | undefined) => owner ? catalog.plugins.filter(p => repoOf(p.repository_url)?.split('/')[0].toLowerCase() === owner.toLowerCase()).length : 0
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)
  return c.json({
    requests: await Promise.all(requests.results.map(async (r) => {
      const payload = JSON.parse(r.payload_json) as { profile?: Record<string, string>, public_key?: string | null, reason?: string, note?: string }
      const owner = r.owner_login
      return {
        id: r.id,
        kind: r.kind,
        owner,
        vendorId: r.vendor_id,
        partner: r.partner,
        by: r.login,
        createdAt: r.created_at,
        profile: payload.profile ?? null,
        keyId: payload.public_key ? keyIdOf(payload.public_key) : null,
        reason: payload.reason ?? null,
        note: payload.note ?? null,
        checks: r.kind === 'application'
          ? {
              listedPlugins: pluginsOf(owner ?? undefined),
              hasKey: !!payload.public_key,
              // How long the organization has existed, read from GitHub.
              createdYear: owner
                ? await cached(`owner-created:${owner.toLowerCase()}`, 86400, async () => {
                    const info = await github<{ created_at?: string }>(`/users/${owner}`, token).catch(() => null)
                    return info?.created_at ? Number(info.created_at.slice(0, 4)) : null
                  })
                : null,
            }
          : null,
      }
    })),
    partners: files.map(p => ({
      name: p.name,
      displayName: p.display_name ?? p.name,
      kind: p.kind ?? 'github_organization',
      owner: p.github_owner ?? null,
      plugins: p.kind === 'vendor' ? vendors.results.find(v => v.partner === p.name)?.plugins ?? 0 : pluginsOf(p.github_owner),
      keyId: keyIdOf(p.public_key),
      expires: p.expires ?? null,
      state: p.revoked ? 'revoked' : p.expires && p.expires < new Date().toISOString().slice(0, 10) ? 'expired' : p.expires && p.expires < soon ? 'expiring' : 'valid',
    })),
    vendors: vendors.results,
  })
})

async function partnerChange(env: Env, session: Session, partner: Record<string, unknown>) {
  const change = newChangeId()
  const t = now()
  const payload = { kind: 'partner_update', partner, submitter: { login: session.user.login, id: session.user.id }, eligibility: `@${session.user.login} is a maintainer` }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, waiting_on, payload_json, dispatched_at, created_at, updated_at)
       VALUES (?, NULL, ?, 'partner', 'maintainer', 'open', 'checks', 'system', ?, ?, ?, ?)`,
    ).bind(change, session.user.id, JSON.stringify(payload), t, t, t),
    event(env, change, 'submitted', session.user.id),
  ])
  try {
    await dispatchApply(env, change, payload)
  }
  catch (error) {
    console.error('dispatch failed', error)
    await env.DB.prepare('UPDATE changes SET outcome_json = ? WHERE id = ?').bind(JSON.stringify({ outcome: 'dispatch_failed' }), change).run()
  }
  return change
}

maintain.post('/partner-requests/:id/approve', async (c) => {
  const session = c.get('session')
  const request = await c.env.DB.prepare(`SELECT * FROM partner_requests WHERE id = ? AND state = 'pending'`).bind(c.req.param('id')).first<{ id: string, kind: string, partner: string, payload_json: string, owner_login: string | null }>()
  if (!request)
    return c.json({ error: 'not_found' }, 404)
  const payload = JSON.parse(request.payload_json) as { profile?: Record<string, string>, public_key?: string, reason?: string }
  const partner = request.kind === 'application'
    ? { name: request.partner, profile: payload.profile, public_key: payload.public_key }
    : request.kind === 'key_rotation'
      ? { name: request.partner, public_key: payload.public_key }
      : request.kind === 'key_revocation'
        ? { name: request.partner, revoke: { reason: payload.reason } }
        : { name: request.partner, profile: payload.profile }
  const change = await partnerChange(c.env, session, partner)
  await c.env.DB.prepare(`UPDATE partner_requests SET state = 'approved', decided_by = ?, decided_at = ?, change_id = ? WHERE id = ?`).bind(session.user.id, now(), change, request.id).run()
  await audit(c.env.DB, { actorId: session.user.id, action: 'maintain.partner_approve', subject: request.partner, detail: { request: request.id, kind: request.kind, change } })
  return c.json({ change })
})

maintain.post('/partner-requests/:id/decline', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }))
  const reason = String(body.reason ?? '').trim().slice(0, 500)
  if (!reason)
    return c.json({ error: 'invalid' }, 422)
  const result = await c.env.DB.prepare(`UPDATE partner_requests SET state = 'declined', reason = ?, decided_by = ?, decided_at = ? WHERE id = ? AND state = 'pending'`).bind(reason, session.user.id, now(), c.req.param('id')).run()
  if (!result.meta.changes)
    return c.json({ error: 'not_found' }, 404)
  await audit(c.env.DB, { actorId: session.user.id, action: 'maintain.partner_decline', subject: c.req.param('id'), detail: { reason } })
  return c.json({ ok: true })
})

// A revocation takes effect at once: it only reduces trust, so it is
// committed without waiting for a review.
maintain.post('/partners/:name/revoke', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }))
  const reason = String(body.reason ?? '').trim().slice(0, 500)
  if (!reason)
    return c.json({ error: 'invalid' }, 422)
  const name = c.req.param('name')
  const change = await partnerChange(c.env, session, { name, revoke: { reason } })
  await audit(c.env.DB, { actorId: session.user.id, action: 'maintain.partner_revoke', subject: name, detail: { change, reason } })
  return c.json({ change }, 201)
})

// A vendor without a repository: its name, its partner file and first admins.
maintain.post('/vendors', async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ slug?: string, name?: string, partner?: string, admins?: string[] }>().catch(() => ({} as Record<string, never>))
  const slug = String(body.slug ?? '').trim().toLowerCase()
  const name = String(body.name ?? '').trim().slice(0, 80)
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(slug) || !name)
    return c.json({ error: 'invalid' }, 422)
  const t = now()
  const row = await c.env.DB.prepare(`INSERT INTO owners (github_login, kind, name, partner, created_at, updated_at) VALUES (?, 'vendor', ?, ?, ?, ?) RETURNING id`)
    .bind(slug, name, body.partner || null, t, t)
    .first<{ id: number }>()
  // First admins by GitHub login; they need not have signed in yet.
  const token = await userToken(c.env, session.id)
  const logins = [...new Set((body.admins ?? []).map(l => String(l).trim()).filter(l => /^[A-Z\d][A-Z\d-]{0,38}$/i.test(l)))].slice(0, 10)
  const users = (await Promise.all(logins.map(l => github<{ id: number, login: string, avatar_url: string, type: string }>(`/users/${l}`, token).catch(() => null))))
    .filter((u): u is { id: number, login: string, avatar_url: string, type: string } => !!u && u.type === 'User')
  if (users.length) {
    await c.env.DB.batch(users.flatMap(u => [
      c.env.DB.prepare(`INSERT INTO users (id, login, avatar_url, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET login = excluded.login`).bind(u.id, u.login, u.avatar_url, t, t),
      c.env.DB.prepare(`INSERT OR IGNORE INTO vendor_members (owner_id, user_id, role, added_by, added_at) VALUES (?, ?, 'admin', ?, ?)`).bind(row!.id, u.id, session.user.id, t),
    ]))
  }
  await audit(c.env.DB, { actorId: session.user.id, action: 'maintain.vendor_create', subject: slug, detail: { name, partner: body.partner ?? null } })
  return c.json({ id: row!.id, admins: users.map(u => u.login) }, 201)
})
