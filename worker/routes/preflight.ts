import type { AppEnv } from '../env'
import type { Manifest, StoreDoc } from '../lib/store'
import { Hono } from 'hono'
import { atLeast } from '../lib/access'
import { github } from '../lib/github'
import { pluginContext } from '../lib/pluginContext'
import { preflightChecks, runtimeDiff, storeDiff } from '../lib/preflight'
import { docFromManifest, headOf, readStore } from '../lib/store'
import { requireSession } from '../middleware/auth'

// Preflight for publishers: pick a branch, tag or commit and see what
// releasing it would change for users (spec 10).

const REF = /^[\w./-]{1,100}$/

async function raw(repo: string, ref: string, path: string): Promise<string | null> {
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/${path}`)
  return response.ok ? response.text() : null
}

function parse<T>(text: string | null): T | null {
  if (!text)
    return null
  try {
    return JSON.parse(text) as T
  }
  catch {
    return null
  }
}

async function imageProblem(url: string): Promise<string> {
  const response = await fetch(url, { method: 'HEAD' }).catch(() => null)
  if (!response?.ok)
    return `unreachable:${response?.status ?? 0}`
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type))
    return `type:${type || 'none'}`
  const length = Number(response.headers.get('content-length'))
  return length > 2 * 1024 * 1024 ? `size:${length}` : ''
}

export const preflight = new Hono<AppEnv>()

preflight.get('/plugins/:id/preflight/refs', requireSession, async (c) => {
  const ctx = await pluginContext(c.env, c.get('session'), c.req.param('id'))
  if (!ctx?.repo)
    return c.json({ error: 'not_found' }, 404)
  if (!atLeast(ctx.role, 'publisher') && !ctx.isMaintainer)
    return c.json({ error: 'no_access' }, 403)
  const [head, branches, tags] = await Promise.all([
    headOf(ctx.token, ctx.repo),
    github<{ name: string, commit: { sha: string } }[]>(`/repos/${ctx.repo}/branches?per_page=20`, ctx.token).catch(() => []),
    github<{ name: string, commit: { sha: string } }[]>(`/repos/${ctx.repo}/tags?per_page=20`, ctx.token).catch(() => []),
  ])
  const commit = await github<{ commit: { committer: { date: string } } }>(`/repos/${ctx.repo}/commits/${head.sha}`, ctx.token).catch(() => null)
  return c.json({
    default: { name: head.branch, sha: head.sha, date: commit?.commit.committer.date ?? null },
    branches: branches.map(b => ({ name: b.name, sha: b.commit.sha })),
    tags: tags.map(t => ({ name: t.name, sha: t.commit.sha })),
    listed: { tag: ctx.tag, version: ctx.version },
  })
})

preflight.get('/plugins/:id/preflight', requireSession, async (c) => {
  const ctx = await pluginContext(c.env, c.get('session'), c.req.param('id'))
  if (!ctx?.repo)
    return c.json({ error: 'not_found' }, 404)
  if (!atLeast(ctx.role, 'publisher') && !ctx.isMaintainer)
    return c.json({ error: 'no_access' }, 403)
  const ref = c.req.query('ref') ?? ''
  if (!REF.test(ref) || ref.includes('..'))
    return c.json({ error: 'invalid_ref' }, 422)
  const [listedState, nextManifestText, nextStoreText, certificate, certificateSignature] = await Promise.all([
    readStore(c.env, ctx.token, { id: ctx.id, repo: ctx.repo, tag: ctx.tag, entry: ctx.entry }),
    raw(ctx.repo, ref, 'plugin.json'),
    raw(ctx.repo, ref, 'plugin.store.json'),
    raw(ctx.repo, ref, 'plugin.signer'),
    raw(ctx.repo, ref, 'plugin.signer.minisig'),
  ])
  const listed = listedState.manifest
  const next = parse<Manifest>(nextManifestText)
  const nextDoc = parse<StoreDoc>(nextStoreText) ?? docFromManifest(next)
  const listedDoc = { ...listedState.doc, name: { ...(listedState.doc.name ?? {}), ...((ctx.entry?.name as Record<string, string> | undefined) ?? {}) } }
  const runtime = runtimeDiff(listed, next)
  const store = storeDiff(listedDoc, nextDoc)
  // New or changed screenshots must load as listed images.
  const changedShots = store.filter(r => r.kind === 'screenshot' && r.sign !== 'del').map(r => r.subject)
  const images: { id: string, problem: string }[] = []
  for (const shot of (nextDoc.screenshots ?? []).filter(s => changedShots.includes(s.id))) {
    for (const path of [shot.path, shot.dark_path].filter((p): p is string => !!p && !p.startsWith('media:'))) {
      const problem = await imageProblem(`https://raw.githubusercontent.com/${ctx.repo}/${encodeURIComponent(ref)}/${path}`)
      if (problem)
        images.push({ id: shot.id, problem })
    }
  }
  const checks = preflightChecks({
    id: ctx.id,
    listedVersion: ctx.version,
    manifest: next,
    primaryKey: (ctx.entry?.author_public_key as string | undefined) ?? null,
    certificate,
    certificateSignature,
    images,
  })
  const version = next?.version ?? null
  return c.json({
    ref,
    listed: { tag: ctx.tag, version: ctx.version },
    version,
    unchanged: { permissions: (next?.permissions ?? []).filter(p => (listed?.permissions ?? []).includes(p)).length },
    runtime,
    store,
    storeFromDocument: !!nextStoreText,
    checks,
    // What the update dialog of the host lists as new in this version.
    dialog: {
      from: ctx.version,
      to: version,
      added: runtime.permissions.filter(r => r.sign === 'add').map(r => ({ kind: r.kind, subject: r.subject })),
    },
    releaseUrl: version ? `https://github.com/${ctx.repo}/releases/new?tag=${encodeURIComponent(`v${version}`)}&target=${encodeURIComponent(ref)}` : null,
  })
})
