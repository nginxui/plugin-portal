import type { AppEnv, Env } from '../env'
import type { PluginContext } from '../lib/pluginContext'
import type { StoreDoc, StoreState } from '../lib/store'
import { Hono } from 'hono'
import { atLeast } from '../lib/access'
import { audit } from '../lib/audit'
import { botEnabled, openBotPullRequest } from '../lib/bot'
import { event, getChange, newChangeId } from '../lib/changes'
import { dispatchApply } from '../lib/deployApp'
import { draftKey, imageUrl, MAX_BYTES, MAX_SIDE, mediaBytes, mediaEnabled, mediaShas, publishedKey, publishMedia, sha256Hex, webpSize } from '../lib/media'
import { pluginContext } from '../lib/pluginContext'
import { cleanRuntime, diffRuntime, mergeRuntime, repoManifest } from '../lib/runtime'
import { cleanDoc, diffDoc, readStore, textsOnly } from '../lib/store'
import { repoFiles, storeJson } from '../lib/storeFiles'
import { now } from '../lib/time'
import { zip } from '../lib/zip'
import { requireSession } from '../middleware/auth'

// The store editor: the plugin's store document as it is, the user's draft,
// and submitting the draft through the store source (spec 7.1, 7.2).

type Source = 'repo-branch' | 'repo-release' | 'catalog'

const README_LIMIT = 64 * 1024

interface DraftRow {
  doc_json: string
  updated_at: number
}

interface Draft {
  doc: StoreDoc
  readme?: string | null
  source?: Source
  // Texts an AI drafted that no one confirmed yet, as field.locale keys.
  ai?: string[]
  // Translations of the runtime strings of plugin.json.
  runtime?: Record<string, Record<string, string>>
}

// What the editor starts from: the document, with the names the listing
// shows, which are the reviewed ones of the entry.
function baseline(state: StoreState, ctx: PluginContext): StoreDoc {
  const names = { ...(state.doc.name ?? {}), ...((ctx.entry?.name as Record<string, string> | undefined) ?? ctx.listing?.name ?? {}) }
  return { ...state.doc, ...(Object.keys(names).length ? { name: names } : {}) }
}

function images(env: Env, doc: StoreDoc, state: StoreState) {
  const out: Record<string, string | null> = {}
  for (const shot of doc.screenshots ?? []) {
    for (const path of [shot.path, shot.dark_path]) {
      if (path)
        out[path] = imageUrl(env, path, state.repo, state.ref)
    }
  }
  return out
}

function canEdit(ctx: PluginContext) {
  return { texts: atLeast(ctx.role, 'translator'), all: atLeast(ctx.role, 'publisher') }
}

// Mounted at the root, so each route names its own middleware instead of a
// catch-all that would cover every other route too.
export const store = new Hono<AppEnv>()

store.get('/plugins/:id/store', requireSession, async (c) => {
  const session = c.get('session')
  const ctx = await pluginContext(c.env, session, c.req.param('id'))
  if (!ctx)
    return c.json({ error: 'not_found' }, 404)
  if (!ctx.role && !ctx.isMaintainer)
    return c.json({ error: 'no_access' }, 403)
  const state = await readStore(c.env, ctx.token, { id: ctx.id, repo: ctx.repo, tag: ctx.tag, entry: ctx.entry })
  const row = await c.env.DB.prepare('SELECT doc_json, updated_at FROM store_drafts WHERE plugin_id = ? AND author_id = ?')
    .bind(ctx.id, session.user.id)
    .first<DraftRow>()
  const draft = row ? { ...(JSON.parse(row.doc_json) as Draft), updatedAt: row.updated_at } : null
  const base = baseline(state, ctx)
  const shown = draft?.doc ?? base
  const open = await c.env.DB.prepare(`SELECT id FROM changes WHERE plugin_id = ? AND kind IN ('store', 'store_source') AND state IN ('open', 'merged') ORDER BY created_at DESC LIMIT 1`)
    .bind(ctx.id)
    .first<{ id: string }>()
  return c.json({
    source: state.source,
    repo: state.repo,
    ref: state.ref,
    tag: ctx.tag,
    version: ctx.version,
    doc: base,
    readme: state.readme?.slice(0, README_LIMIT) ?? null,
    manifest: state.manifest,
    // Fields the catalog entry sets win over the document.
    overrides: Object.fromEntries(['description', 'homepage_url', 'screenshots', 'readme_url', 'icon_url'].filter(k => ctx.entry?.[k] !== undefined).map(k => [k, ctx.entry![k]])),
    images: { ...images(c.env, base, state), ...images(c.env, shown, state) },
    draft,
    items: draft ? [...diffDoc(base, draft.doc), ...diffRuntime(state.manifest, cleanRuntime(draft.runtime, state.manifest))] : [],
    pending: open?.id ?? null,
    canEdit: canEdit(ctx),
    delivery: { bot: botEnabled(c.env), patch: true },
    uploads: mediaEnabled(c.env),
  })
})

store.put('/plugins/:id/store/draft', requireSession, async (c) => {
  const session = c.get('session')
  const ctx = await pluginContext(c.env, session, c.req.param('id'))
  if (!ctx)
    return c.json({ error: 'not_found' }, 404)
  const rights = canEdit(ctx)
  if (!rights.texts)
    return c.json({ error: 'no_access' }, 403)
  const body = await c.req.json<{ doc?: unknown, readme?: unknown, source?: unknown, ai?: unknown[], runtime?: unknown }>().catch(() => ({} as { doc?: unknown, readme?: unknown, source?: unknown, ai?: unknown[], runtime?: unknown }))
  const { doc, problems } = cleanDoc(body.doc)
  const draft: Draft = { doc }
  if (typeof body.readme === 'string')
    draft.readme = body.readme.slice(0, README_LIMIT)
  if (body.source === 'repo-branch' || body.source === 'repo-release' || body.source === 'catalog')
    draft.source = body.source
  if (Array.isArray(body.ai))
    draft.ai = body.ai.filter((k): k is string => typeof k === 'string' && k.length <= 80).slice(0, 300)
  const runtime = cleanRuntime(body.runtime, null)
  if (Object.keys(runtime).length)
    draft.runtime = runtime
  if (!rights.all) {
    const state = await readStore(c.env, ctx.token, { id: ctx.id, repo: ctx.repo, tag: ctx.tag, entry: ctx.entry })
    if (!textsOnly(baseline(state, ctx), doc) || draft.source || draft.readme !== undefined)
      return c.json({ error: 'texts_only' }, 403)
  }
  await c.env.DB.prepare(
    `INSERT INTO store_drafts (plugin_id, author_id, doc_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (plugin_id, author_id) DO UPDATE SET doc_json = excluded.doc_json, updated_at = excluded.updated_at`,
  ).bind(ctx.id, session.user.id, JSON.stringify(draft), now()).run()
  return c.json({ ok: true, problems })
})

store.delete('/plugins/:id/store/draft', requireSession, async (c) => {
  const session = c.get('session')
  await c.env.DB.prepare('DELETE FROM store_drafts WHERE plugin_id = ? AND author_id = ?').bind(c.req.param('id'), session.user.id).run()
  return c.json({ ok: true })
})

async function dispatchOrRecord(env: Env, change: string, payload: unknown) {
  try {
    await dispatchApply(env, change, payload)
  }
  catch (error) {
    console.error('dispatch failed', error)
    await env.DB.batch([
      env.DB.prepare('UPDATE changes SET outcome_json = ? WHERE id = ?').bind(JSON.stringify({ outcome: 'dispatch_failed' }), change),
      event(env, change, 'checks', null, { outcome: 'dispatch_failed' }),
    ])
  }
}

store.post('/plugins/:id/store/submit', requireSession, async (c) => {
  const session = c.get('session')
  const ctx = await pluginContext(c.env, session, c.req.param('id'))
  if (!ctx)
    return c.json({ error: 'not_found' }, 404)
  const rights = canEdit(ctx)
  if (!rights.texts)
    return c.json({ error: 'no_access' }, 403)
  const body = await c.req.json<{ delivery?: string }>().catch(() => ({} as { delivery?: string }))
  const row = await c.env.DB.prepare('SELECT doc_json, updated_at FROM store_drafts WHERE plugin_id = ? AND author_id = ?')
    .bind(ctx.id, session.user.id)
    .first<DraftRow>()
  if (!row)
    return c.json({ error: 'no_draft' }, 409)
  const draft = JSON.parse(row.doc_json) as Draft
  const state = await readStore(c.env, ctx.token, { id: ctx.id, repo: ctx.repo, tag: ctx.tag, entry: ctx.entry })
  const base = baseline(state, ctx)
  const target: Source = draft.source ?? (state.source === 'release' ? 'repo-branch' : state.source)
  const docItems = diffDoc(base, draft.doc)
  // Runtime strings alone leave the store source where it is.
  const moving = target !== state.source && (draft.source !== undefined || docItems.length > 0)
  const runtime = cleanRuntime(draft.runtime, state.manifest)
  const runtimeItems = diffRuntime(state.manifest, runtime)
  const items = [...docItems, ...runtimeItems]
  if (!items.length && !moving)
    return c.json({ error: 'no_change' }, 409)
  // Runtime strings ship in the packages, so they go to the repository.
  if (runtimeItems.length && target === 'catalog')
    return c.json({ error: 'runtime_needs_repository' }, 409)
  if (!rights.all && (!textsOnly(base, draft.doc) || moving))
    return c.json({ error: 'texts_only' }, 403)
  const { problems } = cleanDoc(draft.doc)
  if (problems.length)
    return c.json({ error: 'invalid', problems }, 422)
  // An AI draft is published only once someone confirmed it.
  if (draft.ai?.length)
    return c.json({ error: 'unconfirmed_ai', keys: draft.ai }, 409)
  const busy = await c.env.DB.prepare(`SELECT id FROM changes WHERE plugin_id = ? AND kind IN ('store', 'store_source') AND state = 'open' LIMIT 1`).bind(ctx.id).first()
  if (busy)
    return c.json({ error: 'busy' }, 409)
  if (target !== 'catalog' && !ctx.repo)
    return c.json({ error: 'no_repository' }, 409)

  const t = now()
  const change = newChangeId()
  const submitter = { login: session.user.login, id: session.user.id }
  const eligibility = `@${session.user.login} has ${ctx.access?.permission ?? 'no'} permission on ${ctx.repo}`
  const statements = []
  let delivery: 'catalog' | 'bot' | 'patch' = 'catalog'
  let prNumber: number | null = null
  let prUrl: string | null = null
  let waitingOn: 'system' | 'author' = 'system'
  let stage = 'checks'

  if (target === 'catalog') {
    const missing = await publishMedia(c.env, mediaShas((draft.doc.screenshots ?? []).flatMap(s => [s.path, s.dark_path])))
    if (missing.length)
      return c.json({ error: 'missing_media', missing }, 409)
  }

  const payload: Record<string, unknown> = {
    kind: target === 'catalog' ? 'store_update' : 'store_repo',
    plugin_id: ctx.id,
    doc: draft.doc,
    readme: draft.readme ?? null,
    set_source: moving ? { source: target === 'catalog' ? 'catalog' : 'repo', ...(target === 'catalog' ? {} : { follow: target === 'repo-release' ? 'release' : 'branch' }) } : null,
    items,
    submitter,
    eligibility,
  }

  if (target !== 'catalog') {
    const { doc, images: files } = repoFiles(draft.doc)
    const bytes = await Promise.all(files.map(async f => ({ path: f.path, content: await mediaBytes(c.env, f.sha) })))
    if (bytes.some(f => !f.content))
      return c.json({ error: 'missing_media' }, 409)
    const prFiles: { path: string, content: string | Uint8Array }[] = docItems.length || moving
      ? [{ path: 'plugin.store.json', content: storeJson(doc) }, ...bytes.map(f => ({ path: f.path, content: f.content! }))]
      : []
    if (runtimeItems.length) {
      const current = await repoManifest(ctx.token, ctx.repo!)
      if (!current)
        return c.json({ error: 'no_manifest' }, 409)
      const merged = mergeRuntime(current, runtime)
      prFiles.push({ path: 'plugin.json', content: merged })
      payload.repo_manifest = merged
      payload.runtime = runtime
    }
    payload.repo_doc = doc
    if (body.delivery !== 'patch' && botEnabled(c.env)) {
      const changeUrl = `${c.env.PORTAL_ORIGIN}/changes/${change}`
      const pr = await openBotPullRequest(c.env, {
        repo: ctx.repo!,
        branch: 'portal/store',
        title: docItems.length ? 'Update the store texts of the Nginx UI catalog' : 'Update the translations of plugin.json',
        body: [
          `@${session.user.login} changed the store texts of \`${ctx.id}\` in the Nginx UI developer portal.`,
          '',
          ...items.map(i => `- ${i.label}${i.review ? ' (the catalog reviews names after the merge)' : i.field === 'runtime' ? ' (ships with the next release)' : ''}`),
          '',
          `Merging lists the change at the next catalog update. Follow it in the portal: ${changeUrl}`,
        ].join('\n'),
        message: ['Update the store texts', '', `Requested by @${session.user.login} in the developer portal: ${changeUrl}`, '', `Co-authored-by: ${session.user.login} <${session.user.id}+${session.user.login}@users.noreply.github.com>`].join('\n'),
        files: prFiles,
      })
      delivery = 'bot'
      prNumber = pr.number
      prUrl = pr.url
    }
    else {
      delivery = 'patch'
    }
    stage = 'review'
    waitingOn = 'author'
  }
  payload.delivery = delivery
  if (prUrl)
    payload.pr_url = prUrl
  payload.repo = ctx.repo

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, waiting_on, pr_number, payload_json, dispatched_at, created_at, updated_at)
       VALUES (?, ?, ?, 'store', 'self_service', 'open', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(change, ctx.id, session.user.id, stage, waitingOn, prNumber, JSON.stringify(payload), target === 'catalog' ? t : null, t, t),
    event(c.env, change, 'submitted', session.user.id, { delivery, items: items.length }),
    c.env.DB.prepare('DELETE FROM store_drafts WHERE plugin_id = ? AND author_id = ?').bind(ctx.id, session.user.id),
  )
  if (prNumber)
    statements.push(event(c.env, change, 'review', null, { prNumber, prUrl }))
  await c.env.DB.batch(statements)

  // The catalog source goes through apply.yml. Moving a repository source
  // is a change of the entry of its own, reviewed by a maintainer, since it
  // changes where the listing reads from.
  let moveChange: string | null = null
  if (moving && target !== 'catalog') {
    moveChange = newChangeId()
    const movePayload = { kind: 'entry_update', plugin_id: ctx.id, operations: { store: payload.set_source }, reason: '', submitter, eligibility }
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, waiting_on, payload_json, dispatched_at, created_at, updated_at)
         VALUES (?, ?, ?, 'store_source', 'reviewed', 'open', 'checks', 'system', ?, ?, ?, ?)`,
      ).bind(moveChange, ctx.id, session.user.id, JSON.stringify(movePayload), t, t, t),
      event(c.env, moveChange, 'submitted', session.user.id, { store: payload.set_source }),
    ])
    await dispatchOrRecord(c.env, moveChange, movePayload)
  }
  if (target === 'catalog')
    await dispatchOrRecord(c.env, change, payload)
  await audit(c.env.DB, { actorId: session.user.id, action: 'store.submit', subject: ctx.id, detail: { change, delivery, target, items: items.length } })
  return c.json({ change, moveChange, delivery, prUrl }, 201)
})

// The files of a store change for an author who commits them by hand.
store.get('/changes/:id/patch', requireSession, async (c) => {
  const session = c.get('session')
  const change = await getChange(c.env, c.req.param('id'))
  if (!change || change.kind !== 'store' || !change.payload_json)
    return c.json({ error: 'not_found' }, 404)
  const ctx = await pluginContext(c.env, session, change.plugin_id!)
  if (!ctx || (change.author_id !== session.user.id && !atLeast(ctx.role, 'translator')))
    return c.json({ error: 'not_found' }, 404)
  const payload = JSON.parse(change.payload_json) as { doc: StoreDoc, repo_doc?: StoreDoc, repo_manifest?: string, items?: { field: string }[] }
  const { doc, images: files } = repoFiles(payload.doc)
  const bytes = await Promise.all(files.map(async f => ({ path: f.path, content: await mediaBytes(c.env, f.sha) })))
  const storeChanged = !payload.items || payload.items.some(i => i.field !== 'runtime')
  const archive = zip([
    ...(storeChanged ? [{ path: 'plugin.store.json', content: storeJson(payload.repo_doc ?? doc) }, ...bytes.filter(f => f.content).map(f => ({ path: f.path, content: f.content! }))] : []),
    ...(payload.repo_manifest ? [{ path: 'plugin.json', content: payload.repo_manifest }] : []),
  ])
  return c.body(archive.buffer as ArrayBuffer, 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${change.plugin_id}-store.zip"`,
  })
})

// Uploads a screenshot the studio cropped and encoded as WebP.
store.post('/media', requireSession, async (c) => {
  const session = c.get('session')
  if (!c.env.MEDIA)
    return c.json({ error: 'uploads_off' }, 503)
  const length = Number(c.req.header('Content-Length') ?? 0)
  if (length > MAX_BYTES)
    return c.json({ error: 'too_large' }, 413)
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  if (bytes.length > MAX_BYTES)
    return c.json({ error: 'too_large' }, 413)
  const size = webpSize(bytes)
  if (!size)
    return c.json({ error: 'not_webp' }, 415)
  if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width < 640)
    return c.json({ error: 'bad_size', ...size }, 422)
  const ratio = size.width / size.height
  if (Math.abs(ratio - 1.6) > 0.02)
    return c.json({ error: 'bad_ratio', ...size }, 422)
  const sha = await sha256Hex(bytes)
  if (!await c.env.MEDIA.head(publishedKey(sha))) {
    await c.env.MEDIA.put(draftKey(sha), bytes, { httpMetadata: { contentType: 'image/webp' } })
    await c.env.DB.prepare('INSERT OR IGNORE INTO media_drafts (key, user_id, sha256, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(draftKey(sha), session.user.id, sha, size.width, size.height, now())
      .run()
  }
  return c.json({ path: `media:${sha}`, url: `/api/media/${sha}`, ...size }, 201)
})

export const media = new Hono<AppEnv>()

// Images are named by their digest, so anyone may load one and it never changes.
media.get('/:sha', async (c) => {
  const sha = c.req.param('sha')
  if (!/^[0-9a-f]{64}$/.test(sha) || !c.env.MEDIA)
    return c.json({ error: 'not_found' }, 404)
  const object = await c.env.MEDIA.get(publishedKey(sha)) ?? await c.env.MEDIA.get(draftKey(sha))
  if (!object)
    return c.json({ error: 'not_found' }, 404)
  return c.body(object.body, 200, {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
})
