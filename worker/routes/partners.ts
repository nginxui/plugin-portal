import type { AppEnv, Env, Session } from '../env'
import type { Role } from '../lib/access'
import { Hono } from 'hono'
import { mapLimit, repoAccess } from '../lib/access'
import { audit } from '../lib/audit'
import { cached } from '../lib/cache'
import { catalogEntry, loadCatalog, repoOf } from '../lib/catalog'
import { event, newChangeId, NEXT_NUMBER } from '../lib/changes'
import { randomToken } from '../lib/crypto'
import { dispatchApply } from '../lib/deployApp'
import { github, GitHubError } from '../lib/github'
import { keyIdOf, loadPartners } from '../lib/partners'
import { reservedWord } from '../lib/rules'
import { userToken } from '../lib/session'
import { now } from '../lib/time'
import { checkMaintainer, requireSession } from '../middleware/auth'
import { limit } from '../middleware/limits'

// Organizations, partners and vendors (spec 11.4). A GitHub organization is
// managed on GitHub; the portal only lists its plugins and takes its partner
// application. A vendor without a repository is the one owner whose members
// the portal manages.

const LOGIN = /^[A-Z\d][A-Z\d-]{0,38}$/i
const PARTNER_NAME = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const VENDOR_ROLES = ['admin', 'publisher', 'translator'] as const

interface GitHubOwner {
  id: number
  login: string
  name: string | null
  avatar_url: string
  type: string
  html_url: string
}

async function githubOwner(token: string, login: string): Promise<GitHubOwner | null> {
  return cached(`owner:${login.toLowerCase()}`, 3600, () => github<GitHubOwner>(`/users/${login}`, token).catch(() => null))
}

function cleanProfile(input: Record<string, unknown>) {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const url = (v: unknown) => {
    const s = text(v, 500)
    return /^https:\/\/\S+$/.test(s) ? s : ''
  }
  const profile = { display_name: text(input.display_name, 80), homepage_url: url(input.homepage_url), description: text(input.description, 280), logo_url: url(input.logo_url) }
  if (!profile.display_name || reservedWord(profile.display_name))
    return null
  return profile
}

// Mounted at the root, so each route names its own middleware.
export const partners = new Hono<AppEnv>()

// A GitHub owner: its plugins in the catalog with the user's role on each,
// none included, and its partner state.
partners.get('/owners/:login', requireSession, async (c) => {
  const session = c.get('session')
  const login = c.req.param('login')
  if (!LOGIN.test(login))
    return c.json({ error: 'not_found' }, 404)
  const token = await userToken(c.env, session.id)
  const [owner, catalog, partnerFiles] = await Promise.all([githubOwner(token, login), loadCatalog(c.env), loadPartners(c.env, token)])
  if (!owner)
    return c.json({ error: 'not_found' }, 404)
  const listed = catalog.plugins.filter(p => repoOf(p.repository_url)?.split('/')[0].toLowerCase() === login.toLowerCase())
  const drafts = (await c.env.DB.prepare(`SELECT plugin_id, repo_full_name, state FROM plugins WHERE lower(repo_full_name) LIKE ? AND state != 'listed'`)
    .bind(`${login.toLowerCase()}/%`)
    .all<{ plugin_id: string, repo_full_name: string, state: string }>()).results.filter(d => !listed.some(p => p.id === d.plugin_id))
  const repos = [...new Set([...listed.map(p => repoOf(p.repository_url)!), ...drafts.map(d => d.repo_full_name)])]
  const access = new Map((await mapLimit(repos, 6, repo => repoAccess(c.env, session.user.id, token, repo))).map(a => [a.repo.toLowerCase(), a]))
  const roleOf = (repo: string | null) => (repo ? access.get(repo.toLowerCase())?.role ?? null : null) as Role | null
  const plugins = [
    ...listed.map(p => ({ id: p.id, name: p.name, iconUrl: p.icon_url ?? null, state: 'listed', version: p.releases?.[0]?.version ?? null, repo: repoOf(p.repository_url), role: roleOf(repoOf(p.repository_url)), trust: p.trust ?? null })),
    ...drafts.map(d => ({ id: d.plugin_id, name: { en: d.plugin_id }, iconUrl: null, state: d.state, version: null, repo: d.repo_full_name, role: roleOf(d.repo_full_name), trust: null })),
  ]
  // What is going on with each plugin: a reviewed change in progress, and
  // whether it welcomes community translation.
  const ids = plugins.map(p => p.id)
  const marks = ids.length
    ? (await c.env.DB.prepare(`SELECT p.plugin_id, p.community_translation,
        (SELECT ch.kind FROM changes ch WHERE ch.plugin_id = p.plugin_id AND ch.state = 'open' AND ch.class != 'self_service' ORDER BY ch.created_at DESC LIMIT 1) AS open_kind
        FROM plugins p WHERE p.plugin_id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .all<{ plugin_id: string, community_translation: number, open_kind: string | null }>()).results
    : []
  const markOf = new Map(marks.map(m => [m.plugin_id, m]))
  const catalogBase = c.env.CATALOG_URL.replace(/\/+$/, '')
  const withMarks = plugins.map(p => ({
    ...p,
    openKind: markOf.get(p.id)?.open_kind ?? null,
    community: !!markOf.get(p.id)?.community_translation,
    catalogUrl: p.state === 'listed' ? `${catalogBase}/plugins/${p.id}/` : null,
  }))
  const partner = partnerFiles.find(p => p.github_owner?.toLowerCase() === login.toLowerCase()) ?? null
  const application = await c.env.DB.prepare(`SELECT id, state, reason, created_at FROM partner_requests WHERE lower(owner_login) = ? AND kind = 'application' ORDER BY created_at DESC LIMIT 1`)
    .bind(login.toLowerCase())
    .first<{ id: string, state: string, reason: string | null, created_at: number }>()
  return c.json({
    owner: { login: owner.login, name: owner.name, avatarUrl: owner.avatar_url, kind: owner.type === 'Organization' ? 'organization' : 'user', url: owner.html_url },
    plugins: withMarks,
    canApply: owner.type === 'Organization' && plugins.some(p => p.role === 'admin') && !partner,
    partner: partner && { name: partner.name, displayName: partner.display_name ?? partner.name, keyId: keyIdOf(partner.public_key), expires: partner.expires ?? null, revoked: !!partner.revoked },
    application: application && { id: application.id, state: application.state, reason: application.reason, createdAt: application.created_at },
    accessUrl: owner.type === 'Organization' ? `https://github.com/orgs/${owner.login}/people` : null,
  })
})

partners.post('/owners/:login/partner-application', requireSession, limit('write'), async (c) => {
  const session = c.get('session')
  const login = c.req.param('login')
  const token = await userToken(c.env, session.id)
  const catalog = await loadCatalog(c.env)
  const repos = catalog.plugins.map(p => repoOf(p.repository_url)).filter((r): r is string => !!r && r.split('/')[0].toLowerCase() === login.toLowerCase())
  const access = await mapLimit(repos, 6, repo => repoAccess(c.env, session.user.id, token, repo))
  if (!access.some(a => a.role === 'admin'))
    return c.json({ error: 'no_access' }, 403)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const name = String(body.name ?? '').trim().toLowerCase()
  const profile = cleanProfile(body)
  const publicKey = String(body.public_key ?? '').trim()
  if (!PARTNER_NAME.test(name) || !profile || !keyIdOf(publicKey))
    return c.json({ error: 'invalid' }, 422)
  const open = await c.env.DB.prepare(`SELECT id FROM partner_requests WHERE lower(owner_login) = ? AND kind = 'application' AND state = 'pending'`).bind(login.toLowerCase()).first()
  if (open)
    return c.json({ error: 'pending' }, 409)
  const id = `p_${randomToken(10)}`
  await c.env.DB.prepare(
    `INSERT INTO partner_requests (id, kind, owner_login, partner, payload_json, submitted_by, state, created_at) VALUES (?, 'application', ?, ?, ?, ?, 'pending', ?)`,
  ).bind(id, login, name, JSON.stringify({ profile: { ...profile, kind: 'github_organization', github_owner: login }, public_key: publicKey, note: String(body.note ?? '').slice(0, 1000) }), session.user.id, now()).run()
  await audit(c.env.DB, { actorId: session.user.id, action: 'partner.apply', subject: login, detail: { request: id, name } })
  return c.json({ id }, 201)
})

// Vendors the user belongs to, for the organizations list.
partners.get('/vendors', requireSession, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.github_login AS slug, o.name, o.partner, m.role FROM vendor_members m JOIN owners o ON o.id = m.owner_id WHERE m.user_id = ? AND o.kind = 'vendor'`,
  ).bind(c.get('session').user.id).all<{ id: number, slug: string | null, name: string | null, partner: string | null, role: string }>()
  return c.json({ vendors: results })
})

async function vendorAccess(env: Env, session: Session, id: number) {
  const vendor = await env.DB.prepare(`SELECT * FROM owners WHERE id = ? AND kind = 'vendor'`).bind(id).first<{ id: number, github_login: string | null, name: string | null, partner: string | null, created_at: number }>()
  if (!vendor)
    return null
  const member = await env.DB.prepare('SELECT role FROM vendor_members WHERE owner_id = ? AND user_id = ?').bind(id, session.user.id).first<{ role: Role }>()
  const role = member?.role ?? null
  const isMaintainer = role ? false : await checkMaintainer(env, session.id)
  return role || isMaintainer ? { vendor, role, isMaintainer } : null
}

interface FeedStatus {
  ok: boolean
  latest: string | null
  releases: number
  checkedAt: number
  error?: string
}

async function feedStatus(url: string | undefined): Promise<FeedStatus | null> {
  if (!url)
    return null
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 300 } } as RequestInit)
    if (!response.ok)
      return { ok: false, latest: null, releases: 0, checkedAt: now(), error: `HTTP ${response.status}` }
    const feed = await response.json() as { releases?: { version?: string }[] }
    const releases = (feed.releases ?? []).filter(r => typeof r.version === 'string')
    return { ok: true, latest: releases[0]?.version ?? null, releases: releases.length, checkedAt: now() }
  }
  catch (error) {
    return { ok: false, latest: null, releases: 0, checkedAt: now(), error: (error as Error).message }
  }
}

partners.get('/vendors/:id', requireSession, async (c) => {
  const session = c.get('session')
  const access = await vendorAccess(c.env, session, Number(c.req.param('id')))
  if (!access)
    return c.json({ error: 'not_found' }, 404)
  const { vendor } = access
  const token = await userToken(c.env, session.id)
  const [members, rows, catalog, partnerFiles, requests] = await Promise.all([
    c.env.DB.prepare(`SELECT m.user_id, m.role, m.added_at, u.login, u.avatar_url, a.login AS added_by FROM vendor_members m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users a ON a.id = m.added_by WHERE m.owner_id = ? ORDER BY m.role = 'admin' DESC, m.added_at`).bind(vendor.id).all<{ user_id: number, role: string, added_at: number, login: string | null, avatar_url: string | null, added_by: string | null }>(),
    c.env.DB.prepare(`SELECT plugin_id, state FROM plugins WHERE owner_id = ?`).bind(vendor.id).all<{ plugin_id: string, state: string }>(),
    loadCatalog(c.env),
    loadPartners(c.env, token),
    c.env.DB.prepare(`SELECT id, kind, state, reason, created_at FROM partner_requests WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 10`).bind(vendor.id).all<{ id: string, kind: string, state: string, reason: string | null, created_at: number }>(),
  ])
  const partner = partnerFiles.find(p => p.name === vendor.partner) ?? null
  const plugins = await mapLimit(rows.results, 4, async (row) => {
    const entry = await catalogEntry(c.env, row.plugin_id)
    const listing = catalog.plugins.find(p => p.id === row.plugin_id)
    const releasesUrl = (entry?.distribution as { releases_url?: string } | undefined)?.releases_url
    return {
      id: row.plugin_id,
      name: listing?.name ?? (entry?.name as Record<string, string> | undefined) ?? { en: row.plugin_id },
      state: listing ? 'listed' : row.state,
      version: listing?.releases?.[0]?.version ?? null,
      releasesUrl: releasesUrl ?? null,
      commercial: entry?.commercial ?? null,
      feed: await feedStatus(releasesUrl),
      listedVersions: listing?.releases?.map(r => r.version) ?? [],
      catalogUrl: listing ? `${c.env.CATALOG_URL.replace(/\/+$/, '')}/plugins/${row.plugin_id}/` : null,
    }
  })
  return c.json({
    vendor: { id: vendor.id, slug: vendor.github_login, name: vendor.name, partner: vendor.partner },
    role: access.role,
    isMaintainer: access.isMaintainer,
    canManage: access.role === 'admin' || access.isMaintainer,
    members: members.results.map(m => ({ userId: m.user_id, login: m.login, avatarUrl: m.avatar_url, role: m.role, addedAt: m.added_at, addedBy: m.added_by })),
    plugins,
    partner: partner && { name: partner.name, keyId: keyIdOf(partner.public_key), expires: partner.expires ?? null, revoked: !!partner.revoked },
    requests: requests.results.map(r => ({ id: r.id, kind: r.kind, state: r.state, reason: r.reason, createdAt: r.created_at })),
  })
})

partners.post('/vendors/:id/members', requireSession, async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const access = await vendorAccess(c.env, session, id)
  if (!access || !(access.role === 'admin' || access.isMaintainer))
    return c.json({ error: 'no_access' }, 403)
  const body = await c.req.json<{ login?: string, role?: string }>().catch(() => ({} as { login?: string, role?: string }))
  const role = VENDOR_ROLES.find(r => r === body.role) ?? 'publisher'
  if (!body.login || !LOGIN.test(body.login))
    return c.json({ error: 'invalid' }, 422)
  const token = await userToken(c.env, session.id)
  let user: GitHubOwner
  try {
    user = await github<GitHubOwner>(`/users/${body.login}`, token)
  }
  catch (error) {
    if (error instanceof GitHubError && error.status === 404)
      return c.json({ error: 'no_such_user' }, 404)
    throw error
  }
  if (user.type !== 'User')
    return c.json({ error: 'not_a_user' }, 422)
  const t = now()
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO users (id, login, avatar_url, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET login = excluded.login`).bind(user.id, user.login, user.avatar_url, t, t),
    c.env.DB.prepare(`INSERT INTO vendor_members (owner_id, user_id, role, added_by, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner_id, user_id) DO UPDATE SET role = excluded.role`).bind(id, user.id, role, session.user.id, t),
  ])
  await audit(c.env.DB, { actorId: session.user.id, action: 'vendor.member_add', subject: access.vendor.name ?? String(id), detail: { login: user.login, role } })
  return c.json({ ok: true }, 201)
})

partners.patch('/vendors/:id/members/:userId', requireSession, async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const access = await vendorAccess(c.env, session, id)
  if (!access || !(access.role === 'admin' || access.isMaintainer))
    return c.json({ error: 'no_access' }, 403)
  const body = await c.req.json<{ role?: string }>().catch(() => ({} as { role?: string }))
  const role = VENDOR_ROLES.find(r => r === body.role)
  if (!role)
    return c.json({ error: 'invalid' }, 422)
  const userId = Number(c.req.param('userId'))
  // A vendor keeps at least one admin.
  if (role !== 'admin') {
    const admins = await c.env.DB.prepare(`SELECT count(*) AS n FROM vendor_members WHERE owner_id = ? AND role = 'admin' AND user_id != ?`).bind(id, userId).first<{ n: number }>()
    if (!admins?.n)
      return c.json({ error: 'last_admin' }, 409)
  }
  await c.env.DB.prepare('UPDATE vendor_members SET role = ? WHERE owner_id = ? AND user_id = ?').bind(role, id, userId).run()
  await audit(c.env.DB, { actorId: session.user.id, action: 'vendor.member_role', subject: access.vendor.name ?? String(id), detail: { userId, role } })
  return c.json({ ok: true })
})

partners.delete('/vendors/:id/members/:userId', requireSession, async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const access = await vendorAccess(c.env, session, id)
  if (!access || !(access.role === 'admin' || access.isMaintainer))
    return c.json({ error: 'no_access' }, 403)
  const userId = Number(c.req.param('userId'))
  const admins = await c.env.DB.prepare(`SELECT count(*) AS n FROM vendor_members WHERE owner_id = ? AND role = 'admin' AND user_id != ?`).bind(id, userId).first<{ n: number }>()
  if (!admins?.n)
    return c.json({ error: 'last_admin' }, 409)
  await c.env.DB.prepare('DELETE FROM vendor_members WHERE owner_id = ? AND user_id = ?').bind(id, userId).run()
  await audit(c.env.DB, { actorId: session.user.id, action: 'vendor.member_remove', subject: access.vendor.name ?? String(id), detail: { userId } })
  return c.json({ ok: true })
})

async function dispatchChange(env: Env, session: Session, opts: { pluginId: string | null, kind: string, payload: Record<string, unknown> }) {
  const change = newChangeId()
  const t = now()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO changes (number, id, plugin_id, author_id, kind, class, state, stage, waiting_on, payload_json, dispatched_at, created_at, updated_at)
       VALUES (${NEXT_NUMBER}, ?, ?, ?, ?, 'reviewed', 'open', 'checks', 'system', ?, ?, ?, ?)`,
    ).bind(change, opts.pluginId, session.user.id, opts.kind, JSON.stringify(opts.payload), t, t, t),
    event(env, change, 'submitted', session.user.id),
  ])
  try {
    await dispatchApply(env, change, opts.payload)
  }
  catch (error) {
    console.error('dispatch failed', error)
    await env.DB.prepare('UPDATE changes SET outcome_json = ? WHERE id = ?').bind(JSON.stringify({ outcome: 'dispatch_failed' }), change).run()
  }
  return change
}

// A commercial plugin of a vendor: the feed and the listing, reviewed.
partners.post('/vendors/:id/plugins', requireSession, async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const access = await vendorAccess(c.env, session, id)
  if (!access || !(access.role === 'admin' || access.role === 'publisher'))
    return c.json({ error: 'no_access' }, 403)
  if (!access.vendor.partner)
    return c.json({ error: 'not_partner' }, 409)
  const body = await c.req.json<{ id?: string, name?: Record<string, string>, releases_url?: string, categories?: string[], license?: string }>().catch(() => ({} as Record<string, never>))
  const pluginId = String(body.id ?? '').trim()
  if (!/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/.test(pluginId) || !body.name?.en || !/^https:\/\/\S+$/.test(body.releases_url ?? ''))
    return c.json({ error: 'invalid' }, 422)
  const t = now()
  await c.env.DB.prepare(
    `INSERT INTO plugins (plugin_id, owner_id, state, created_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?) ON CONFLICT (plugin_id) DO NOTHING`,
  ).bind(pluginId, id, session.user.id, t, t).run()
  const owned = await c.env.DB.prepare('SELECT owner_id FROM plugins WHERE plugin_id = ?').bind(pluginId).first<{ owner_id: number | null }>()
  if (owned?.owner_id !== id)
    return c.json({ error: 'taken' }, 409)
  const change = await dispatchChange(c.env, session, {
    pluginId,
    kind: 'new_listing',
    payload: { kind: 'vendor_listing', listing: { id: pluginId, name: body.name, partner: access.vendor.partner, releases_url: body.releases_url, categories: body.categories ?? [], license: body.license }, submitter: { login: session.user.login, id: session.user.id }, eligibility: `@${session.user.login} is a ${access.role} of the vendor ${access.vendor.name}` },
  })
  await audit(c.env.DB, { actorId: session.user.id, action: 'change.submit', subject: pluginId, detail: { change, vendor: id } })
  return c.json({ change }, 201)
})

partners.put('/vendors/:id/plugins/:pluginId/commercial', requireSession, async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const access = await vendorAccess(c.env, session, id)
  if (!access || !(access.role === 'admin' || access.role === 'publisher'))
    return c.json({ error: 'no_access' }, 403)
  const pluginId = c.req.param('pluginId')
  const owned = await c.env.DB.prepare('SELECT owner_id FROM plugins WHERE plugin_id = ?').bind(pluginId).first<{ owner_id: number | null }>()
  if (owned?.owner_id !== id)
    return c.json({ error: 'not_found' }, 404)
  const body = await c.req.json<{ pricing?: Record<string, string>, purchase_url?: string, trial_days?: number, license?: string }>().catch(() => ({} as Record<string, never>))
  if (!body.pricing?.en || !/^https:\/\/\S+$/.test(body.purchase_url ?? ''))
    return c.json({ error: 'invalid' }, 422)
  const change = await dispatchChange(c.env, session, {
    pluginId,
    kind: 'commercial',
    payload: { kind: 'entry_update', plugin_id: pluginId, operations: { commercial: { pricing: body.pricing, purchase_url: body.purchase_url, ...(Number.isInteger(body.trial_days) ? { trial_days: body.trial_days } : {}), ...(body.license ? { license: body.license } : {}) } }, reason: '', submitter: { login: session.user.login, id: session.user.id }, eligibility: `@${session.user.login} is a ${access.role} of the vendor ${access.vendor.name}` },
  })
  await audit(c.env.DB, { actorId: session.user.id, action: 'change.submit', subject: pluginId, detail: { change, commercial: true } })
  return c.json({ change }, 201)
})

// A key rotation or revocation request, decided by a maintainer.
partners.post('/vendors/:id/key-request', requireSession, limit('write'), async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const access = await vendorAccess(c.env, session, id)
  if (!access || access.role !== 'admin' || !access.vendor.partner)
    return c.json({ error: 'no_access' }, 403)
  const body = await c.req.json<{ kind?: string, public_key?: string, reason?: string }>().catch(() => ({} as Record<string, string>))
  const kind = body.kind === 'revocation' ? 'key_revocation' : body.kind === 'rotation' ? 'key_rotation' : null
  if (!kind || (kind === 'key_rotation' && !keyIdOf(body.public_key ?? '')) || !String(body.reason ?? '').trim())
    return c.json({ error: 'invalid' }, 422)
  const rid = `p_${randomToken(10)}`
  await c.env.DB.prepare(
    `INSERT INTO partner_requests (id, kind, vendor_id, partner, payload_json, submitted_by, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).bind(rid, kind, id, access.vendor.partner, JSON.stringify({ public_key: body.public_key ?? null, reason: String(body.reason).slice(0, 500) }), session.user.id, now()).run()
  await audit(c.env.DB, { actorId: session.user.id, action: 'partner.key_request', subject: access.vendor.partner, detail: { request: rid, kind } })
  return c.json({ id: rid }, 201)
})
