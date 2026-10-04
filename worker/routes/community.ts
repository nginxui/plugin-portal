import type { AppEnv } from '../env'
import type { SuggestionRow } from '../lib/translations'
import { Hono } from 'hono'
import { atLeast, mapLimit } from '../lib/access'
import { AiError, defaultProvider, draft, presentProvider } from '../lib/ai'
import { audit } from '../lib/audit'
import { loadCatalog, repoOf } from '../lib/catalog'
import { glossary } from '../lib/glossary'
import { insightsOf } from '../lib/insights'
import { isHostLocale } from '../lib/locales'
import { pluginContext } from '../lib/pluginContext'
import { reservedWord } from '../lib/rules'
import { userToken } from '../lib/session'
import { readStore } from '../lib/store'
import { now } from '../lib/time'
import { flushAccepted, textOf, validField } from '../lib/translations'
import { requireSession } from '../middleware/auth'

// Translation in the portal: AI drafts for managers, and community
// translation, which a plugin's admin turns on and anyone signed in may then
// suggest to (spec 9).

const LIMITS: Record<string, number> = { name: 64, description: 1000, caption: 200 }
const limitOf = (field: string) => LIMITS[field.startsWith('caption:') ? 'caption' : field] ?? 200

interface PluginRow {
  community_translation: number
  community_locales: string | null
  translations_pr: number | null
}

async function settingsOf(env: AppEnv['Bindings'], id: string) {
  const row = await env.DB.prepare('SELECT community_translation, community_locales, translations_pr FROM plugins WHERE plugin_id = ?').bind(id).first<PluginRow>()
  return {
    enabled: !!row?.community_translation,
    locales: row?.community_locales ? JSON.parse(row.community_locales) as string[] : null,
    translationsPr: row?.translations_pr ?? null,
  }
}

export const community = new Hono<AppEnv>()

community.post('/ai/draft', requireSession, async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ plugin_id?: string, field?: string, locale?: string, source?: string }>().catch(() => ({} as Record<string, string>))
  const runtime = /^reason:[a-z][a-z0-9._-]{0,47}$/.test(body.field ?? '')
  if (!body.plugin_id || !body.field || !body.locale || !body.source || !(validField(body.field) || runtime) || !isHostLocale(body.locale) || body.locale === 'en')
    return c.json({ error: 'invalid' }, 422)
  const ctx = await pluginContext(c.env, session, body.plugin_id)
  if (!ctx || !atLeast(ctx.role, 'translator'))
    return c.json({ error: 'no_access' }, 403)
  const name = (ctx.listing?.name.en ?? ctx.id) as string
  try {
    const result = await draft(c.env, session.user.id, {
      source: body.source.slice(0, 2000),
      locale: body.locale,
      field: runtime ? 'note' : body.field.startsWith('caption:') ? 'caption' : body.field as 'name' | 'description',
      plugin: name,
    })
    await audit(c.env.DB, { actorId: session.user.id, action: 'ai.draft', subject: ctx.id, detail: { field: body.field, locale: body.locale, provider: result.provider.name, model: result.provider.model } })
    return c.json({ text: result.text, remaining: result.remaining })
  }
  catch (error) {
    if (error instanceof AiError)
      return c.json({ error: error.code }, error.code === 'quota' ? 429 : 503)
    throw error
  }
})

// What the editor needs to offer drafts: whether a provider is on and the
// user's quota left today.
community.get('/ai/status', requireSession, async (c) => {
  const provider = await defaultProvider(c.env)
  if (!provider)
    return c.json({ enabled: false })
  const usage = await c.env.DB.prepare('SELECT requests FROM ai_usage WHERE user_id = ? AND day = ?').bind(c.get('session').user.id, new Date().toISOString().slice(0, 10)).first<{ requests: number }>()
  return c.json({ enabled: true, provider: presentProvider(provider).name, remaining: Math.max(0, provider.daily_quota - (usage?.requests ?? 0)) })
})

community.get('/glossary/:locale', requireSession, async c => c.json({ terms: await glossary(c.req.param('locale')) }))

community.get('/plugins/:id/community', requireSession, async (c) => {
  const session = c.get('session')
  const ctx = await pluginContext(c.env, session, c.req.param('id'))
  if (!ctx)
    return c.json({ error: 'not_found' }, 404)
  const settings = await settingsOf(c.env, ctx.id)
  const canReview = atLeast(ctx.role, 'translator')
  const { results } = canReview
    ? await c.env.DB.prepare(
        `SELECT s.*, u.login AS login, u.avatar_url AS avatar FROM suggestions s LEFT JOIN users u ON u.id = s.author_id
         WHERE s.plugin_id = ? AND s.state = 'pending' ORDER BY s.created_at LIMIT 100`,
      ).bind(ctx.id).all<SuggestionRow & { login: string | null, avatar: string | null }>()
    : { results: [] }
  const open = await c.env.DB.prepare(`SELECT id, pr_number, payload_json FROM changes WHERE plugin_id = ? AND kind = 'translations' AND state IN ('open', 'merged') ORDER BY created_at DESC LIMIT 1`)
    .bind(ctx.id)
    .first<{ id: string, pr_number: number | null, payload_json: string | null }>()
  const counts = open
    ? await c.env.DB.prepare(`SELECT count(*) AS strings, count(DISTINCT decided_at) AS batches FROM suggestions WHERE change_id = ?`).bind(open.id).first<{ strings: number, batches: number }>()
    : null
  return c.json({
    ...settings,
    canManage: atLeast(ctx.role, 'admin'),
    canReview,
    pending: results.map(s => ({ id: s.id, field: s.field, locale: s.locale, text: s.text, author: s.login, avatarUrl: s.avatar, createdAt: s.created_at })),
    rolling: open ? { change: open.id, prNumber: open.pr_number, prUrl: (JSON.parse(open.payload_json ?? '{}') as { pr_url?: string }).pr_url ?? null, strings: counts?.strings ?? 0, batches: counts?.batches ?? 0 } : null,
  })
})

community.patch('/plugins/:id/community', requireSession, async (c) => {
  const session = c.get('session')
  const ctx = await pluginContext(c.env, session, c.req.param('id'))
  if (!ctx)
    return c.json({ error: 'not_found' }, 404)
  if (!atLeast(ctx.role, 'admin'))
    return c.json({ error: 'no_access' }, 403)
  const body = await c.req.json<{ enabled?: boolean, locales?: string[] | null }>().catch(() => ({} as { enabled?: boolean, locales?: string[] | null }))
  const locales = Array.isArray(body.locales) ? [...new Set(body.locales.filter(l => isHostLocale(l) && l !== 'en'))] : null
  const t = now()
  await c.env.DB.prepare(
    `INSERT INTO plugins (plugin_id, repo_full_name, state, community_translation, community_locales, created_at, updated_at) VALUES (?, ?, 'listed', ?, ?, ?, ?)
     ON CONFLICT (plugin_id) DO UPDATE SET community_translation = excluded.community_translation, community_locales = excluded.community_locales, updated_at = excluded.updated_at`,
  ).bind(ctx.id, ctx.repo, body.enabled ? 1 : 0, locales?.length ? JSON.stringify(locales) : null, t, t).run()
  await audit(c.env.DB, { actorId: session.user.id, action: body.enabled ? 'community.enable' : 'community.disable', subject: ctx.id, detail: { locales } })
  return c.json({ ok: true })
})

community.post('/plugins/:id/suggestions', requireSession, async (c) => {
  const session = c.get('session')
  const ctx = await pluginContext(c.env, session, c.req.param('id'))
  if (!ctx)
    return c.json({ error: 'not_found' }, 404)
  const settings = await settingsOf(c.env, ctx.id)
  if (!settings.enabled)
    return c.json({ error: 'closed' }, 403)
  const body = await c.req.json<{ field?: string, locale?: string, text?: string }>().catch(() => ({} as Record<string, string>))
  const text = (body.text ?? '').trim()
  if (!body.field || !validField(body.field) || !body.locale || !isHostLocale(body.locale) || body.locale === 'en' || !text)
    return c.json({ error: 'invalid' }, 422)
  if (settings.locales && !settings.locales.includes(body.locale))
    return c.json({ error: 'locale_closed' }, 403)
  // The same checks as the author's own texts.
  if (text.length > limitOf(body.field) || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(text) || (body.field === 'name' && reservedWord(text)))
    return c.json({ error: 'not_allowed' }, 422)
  if (body.field === 'name') {
    const underReview = await c.env.DB.prepare(`SELECT id FROM changes WHERE plugin_id = ? AND state = 'open' AND kind IN ('store', 'names', 'translations') LIMIT 1`).bind(ctx.id).first()
    if (underReview)
      return c.json({ error: 'name_locked' }, 409)
  }
  const mine = await c.env.DB.prepare(`SELECT count(*) AS n FROM suggestions WHERE author_id = ? AND state = 'pending' AND created_at > ?`).bind(session.user.id, now() - 86400).first<{ n: number }>()
  if ((mine?.n ?? 0) >= 200)
    return c.json({ error: 'rate_limited' }, 429)
  // A new suggestion for the same text replaces the user's pending one.
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM suggestions WHERE plugin_id = ? AND field = ? AND locale = ? AND author_id = ? AND state = 'pending'`).bind(ctx.id, body.field, body.locale, session.user.id),
    c.env.DB.prepare(`INSERT INTO suggestions (plugin_id, field, locale, text, author_id, state, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`).bind(ctx.id, body.field, body.locale, text, session.user.id, now()),
  ])
  return c.json({ ok: true }, 201)
})

// Accepts, edits before accepting, or declines suggestions in one batch;
// accepted ones go out at once.
community.post('/plugins/:id/suggestions/decide', requireSession, async (c) => {
  const session = c.get('session')
  const ctx = await pluginContext(c.env, session, c.req.param('id'))
  if (!ctx)
    return c.json({ error: 'not_found' }, 404)
  if (!atLeast(ctx.role, 'translator'))
    return c.json({ error: 'no_access' }, 403)
  const settings = await settingsOf(c.env, ctx.id)
  if (!settings.enabled)
    return c.json({ error: 'closed' }, 403)
  const body = await c.req.json<{ accept?: { id: number, text?: string }[], decline?: { id: number, reason?: string }[] }>().catch(() => ({} as { accept?: { id: number, text?: string }[], decline?: { id: number, reason?: string }[] }))
  const t = now()
  const statements = []
  for (const a of body.accept ?? []) {
    const text = typeof a.text === 'string' ? a.text.trim().slice(0, 1000) : null
    statements.push(text
      ? c.env.DB.prepare(`UPDATE suggestions SET state = 'accepted', text = ?, decided_by = ?, decided_at = ? WHERE id = ? AND plugin_id = ? AND state = 'pending'`).bind(text, session.user.id, t, a.id, ctx.id)
      : c.env.DB.prepare(`UPDATE suggestions SET state = 'accepted', decided_by = ?, decided_at = ? WHERE id = ? AND plugin_id = ? AND state = 'pending'`).bind(session.user.id, t, a.id, ctx.id))
  }
  for (const d of body.decline ?? []) {
    statements.push(c.env.DB.prepare(`UPDATE suggestions SET state = 'declined', reason = ?, decided_by = ?, decided_at = ? WHERE id = ? AND plugin_id = ? AND state = 'pending'`)
      .bind(String(d.reason ?? '').trim().slice(0, 500) || null, session.user.id, t, d.id, ctx.id))
  }
  if (!statements.length)
    return c.json({ error: 'invalid' }, 422)
  await c.env.DB.batch(statements)
  await audit(c.env.DB, { actorId: session.user.id, action: 'community.decide', subject: ctx.id, detail: { accepted: (body.accept ?? []).length, declined: (body.decline ?? []).length } })
  const sent = (body.accept ?? []).length ? await flushAccepted(c.env, ctx, { login: session.user.login, id: session.user.id }) : null
  return c.json({ ok: true, change: sent?.change ?? null, delivery: sent?.delivery ?? null })
})

// The translator page: their languages, plugins that lack them, their
// suggestions through review.
community.get('/translate', requireSession, async (c) => {
  const session = c.get('session')
  const langs = (await c.env.DB.prepare('SELECT locale FROM translator_langs WHERE user_id = ?').bind(session.user.id).all<{ locale: string }>()).results.map(r => r.locale)
  const [counts, recent, open] = await Promise.all([
    c.env.DB.prepare(`SELECT state, count(*) AS n FROM suggestions WHERE author_id = ? GROUP BY state`).bind(session.user.id).all<{ state: string, n: number }>(),
    c.env.DB.prepare(
      `SELECT s.*, c.state AS change_state, c.stage AS change_stage, c.pr_number AS change_pr, u.login AS decider
       FROM suggestions s LEFT JOIN changes c ON c.id = s.change_id LEFT JOIN users u ON u.id = s.decided_by
       WHERE s.author_id = ? ORDER BY coalesce(s.decided_at, s.created_at) DESC LIMIT 60`,
    ).bind(session.user.id).all<SuggestionRow & { change_state: string | null, change_stage: string | null, change_pr: number | null, decider: string | null }>(),
    c.env.DB.prepare(
      `SELECT p.plugin_id, p.community_locales, p.updated_at,
         (SELECT avg(s.decided_at - s.created_at) FROM suggestions s WHERE s.plugin_id = p.plugin_id AND s.decided_at IS NOT NULL) AS review_seconds
       FROM plugins p WHERE p.community_translation = 1`,
    ).all<{ plugin_id: string, community_locales: string | null, updated_at: number, review_seconds: number | null }>(),
  ])
  // What each open plugin lacks in the user's languages, as listed.
  const catalog = await loadCatalog(c.env)
  const byId = new Map(catalog.plugins.map(p => [p.id, p as typeof p & { screenshots?: { caption?: Record<string, string>, dark_url?: string }[] }]))
  const missingIn = (id: string, locales: string[] | null) => {
    const listing = byId.get(id)
    if (!listing)
      return 0
    const texts = [listing.name, listing.description, ...(listing.screenshots ?? []).map(s => s.caption)].filter((t): t is Record<string, string> => !!t?.en)
    const wanted = langs.filter(l => !locales || locales.includes(l))
    return texts.reduce((n, t) => n + wanted.filter(l => !t[l]).length, 0)
  }
  // Downloads of the recent releases, for sorting by installs.
  const token = await userToken(c.env, session.id).catch(() => '')
  const installs = new Map(await mapLimit(open.results, 6, async (p) => {
    const listing = byId.get(p.plugin_id)
    if (!listing || !token)
      return [p.plugin_id, 0] as const
    const insights = await insightsOf(c.env, token, listing).catch(() => null)
    return [p.plugin_id, (insights?.downloads ?? []).reduce((n, d) => n + d.count, 0)] as const
  }))
  const nameOf = (id: string) => byId.get(id)?.name ?? { en: id }
  // Decisions on the user's suggestions, one per batch a reviewer decided.
  const decisions: { pluginId: string, name: Record<string, string>, state: string, count: number, decider: string | null, reason: string | null, at: number }[] = []
  for (const s of recent.results) {
    if (!s.decided_at || s.state === 'pending')
      continue
    const state = s.state === 'declined' ? 'declined' : 'accepted'
    const last = decisions.find(d => d.pluginId === s.plugin_id && d.state === state && d.at === s.decided_at)
    if (last)
      last.count++
    else if (decisions.length < 8)
      decisions.push({ pluginId: s.plugin_id, name: nameOf(s.plugin_id), state, count: 1, decider: s.decider, reason: s.reason, at: s.decided_at })
  }
  // Where the user's suggestions stand, per plugin.
  const progress: { pluginId: string, name: Record<string, string>, iconUrl: string | null, count: number, state: string, prNumber: number | null }[] = []
  const rank = ['pending', 'accepted', 'merged', 'live']
  for (const s of recent.results) {
    if (s.state === 'declined')
      continue
    const state = s.change_state === 'live' ? 'live' : s.change_state === 'merged' || s.state === 'merged' ? 'merged' : s.state === 'accepted' ? 'accepted' : 'pending'
    const found = progress.find(p => p.pluginId === s.plugin_id)
    if (found) {
      found.count++
      if (rank.indexOf(state) < rank.indexOf(found.state))
        found.state = state
      found.prNumber ??= s.change_pr
    }
    else if (progress.length < 6) {
      progress.push({ pluginId: s.plugin_id, name: nameOf(s.plugin_id), iconUrl: byId.get(s.plugin_id)?.icon_url ?? null, count: 1, state, prNumber: s.change_pr })
    }
  }
  return c.json({
    langs,
    counts: Object.fromEntries(counts.results.map(r => [r.state, r.n])),
    decisions,
    progress,
    suggestions: recent.results.slice(0, 30).map(s => ({ id: s.id, pluginId: s.plugin_id, field: s.field, locale: s.locale, text: s.text, state: s.state, reason: s.reason, decidedAt: s.decided_at, createdAt: s.created_at, change: s.change_id, changeState: s.change_state, changeStage: s.change_stage })),
    open: open.results.map((p) => {
      const locales = p.community_locales ? JSON.parse(p.community_locales) as string[] : null
      const listing = byId.get(p.plugin_id)
      return {
        pluginId: p.plugin_id,
        name: listing?.name ?? { en: p.plugin_id },
        owner: repoOf(listing?.repository_url)?.split('/')[0] ?? null,
        iconUrl: listing?.icon_url ?? null,
        locales,
        missing: missingIn(p.plugin_id, locales),
        updatedAt: p.updated_at,
        installs: installs.get(p.plugin_id) ?? 0,
        reviewHours: p.review_seconds === null ? null : Math.round(p.review_seconds / 3600),
      }
    }),
  })
})

community.put('/translate/langs', requireSession, async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ locales?: string[] }>().catch(() => ({} as { locales?: string[] }))
  const locales = [...new Set((body.locales ?? []).filter(l => isHostLocale(l) && l !== 'en'))].slice(0, 13)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM translator_langs WHERE user_id = ?').bind(session.user.id),
    ...locales.map(l => c.env.DB.prepare('INSERT INTO translator_langs (user_id, locale) VALUES (?, ?)').bind(session.user.id, l)),
  ])
  return c.json({ ok: true, locales })
})

// One plugin as a translator sees it: every text in English and in their
// languages, with their own pending suggestions.
community.get('/translate/plugins/:id', requireSession, async (c) => {
  const session = c.get('session')
  const ctx = await pluginContext(c.env, session, c.req.param('id'))
  if (!ctx)
    return c.json({ error: 'not_found' }, 404)
  const settings = await settingsOf(c.env, ctx.id)
  if (!settings.enabled)
    return c.json({ error: 'closed' }, 403)
  const state = await readStore(c.env, ctx.token, { id: ctx.id, repo: ctx.repo, tag: ctx.tag, entry: ctx.entry })
  const doc = { ...state.doc, name: { ...(state.doc.name ?? {}), ...((ctx.entry?.name as Record<string, string> | undefined) ?? {}) } }
  const mine = await c.env.DB.prepare(`SELECT field, locale, text, state FROM suggestions WHERE plugin_id = ? AND author_id = ? AND state = 'pending'`).bind(ctx.id, session.user.id).all<{ field: string, locale: string, text: string }>()
  const nameLocked = !!await c.env.DB.prepare(`SELECT id FROM changes WHERE plugin_id = ? AND state = 'open' AND kind IN ('store', 'names', 'translations') LIMIT 1`).bind(ctx.id).first()
  const fields = ['name', 'description', ...(doc.screenshots ?? []).map(s => `caption:${s.id}`)]
  return c.json({
    pluginId: ctx.id,
    name: doc.name,
    locales: settings.locales,
    nameLocked,
    rows: fields.map(field => ({ field, en: textOf(doc, field, 'en'), texts: Object.fromEntries((settings.locales ?? []).map(l => [l, textOf(doc, field, l)])), all: field === 'name' ? doc.name : field === 'description' ? doc.description ?? {} : doc.screenshots?.find(s => `caption:${s.id}` === field)?.caption ?? {} })),
    mine: mine.results,
  })
})
