import type { Env } from '../env'
import type { CatalogEntry, Localized } from './catalog'
import type { StoreSource } from './insights'
import { cached } from './cache'
import { github } from './github'
import { storeSourceOf } from './insights'
import { HOST_LOCALES } from './locales'
import { reservedWord } from './rules'

// The store document of a plugin: names, descriptions, homepage and
// screenshots, read from where the catalog entry says it lives (spec 7.1).
// A plugin without a document shows what the plugin.json of its listed
// release gives, which the editor turns into a first document.

export interface StoreScreenshot {
  id: string
  path: string
  dark_path?: string
  caption?: Localized
}

export interface StoreDoc {
  name?: Localized
  description?: Localized
  homepage_url?: string
  screenshots?: StoreScreenshot[]
  // Translations of the notes that explain each permission, keyed by
  // permission. English stays in plugin.json, next to the permissions.
  permission_reasons?: Record<string, Localized>
}

export const LIMITS = { name: 64, description: 1000, caption: 200, reason: 300, screenshots: 8 }
const PERMISSION = /^[a-z][a-z0-9._-]{0,47}$/

export interface Manifest {
  id?: string
  name?: string
  description?: string
  version?: string
  homepage_url?: string
  min_nginx_ui_version?: string
  capabilities?: string[]
  permissions?: string[]
  network_hosts?: string[]
  permission_reasons?: Record<string, string>
  screenshots?: { id: string, path: string, dark_path?: string, caption?: string }[]
  i18n?: Record<string, { name?: string, description?: string, screenshot_captions?: Record<string, string>, permission_reasons?: Record<string, string> }>
  settings_schema?: unknown
  conflicts?: string[]
  requires?: unknown
  [key: string]: unknown
}

export interface StoreState {
  source: StoreSource
  // Where the document and its images are read: a commit, a tag or main.
  repo: string | null
  ref: string | null
  doc: StoreDoc
  readme: string | null
  manifest: Manifest | null
  tag: string | null
}

function localizedOf(en: string | undefined, i18n: Manifest['i18n'], key: 'name' | 'description'): Localized | undefined {
  const out: Localized = {}
  if (en?.trim())
    out.en = en.trim()
  for (const [locale, text] of Object.entries(i18n ?? {})) {
    const value = text?.[key]
    if (typeof value === 'string' && value.trim())
      out[locale] = value.trim()
  }
  return Object.keys(out).length ? out : undefined
}

/** The store texts a manifest gives, as a document. */
export function docFromManifest(manifest: Manifest | null): StoreDoc {
  if (!manifest)
    return {}
  const doc: StoreDoc = {}
  const name = localizedOf(manifest.name, manifest.i18n, 'name')
  const description = localizedOf(manifest.description, manifest.i18n, 'description')
  if (name)
    doc.name = name
  if (description)
    doc.description = description
  if (manifest.homepage_url)
    doc.homepage_url = manifest.homepage_url
  const reasons = reasonsOf(manifest)
  if (reasons)
    doc.permission_reasons = reasons
  if (manifest.screenshots?.length) {
    doc.screenshots = manifest.screenshots.map((shot) => {
      const caption: Localized = {}
      if (shot.caption)
        caption.en = shot.caption
      for (const [locale, text] of Object.entries(manifest.i18n ?? {})) {
        const value = text?.screenshot_captions?.[shot.id]
        if (value)
          caption[locale] = value
      }
      return { id: shot.id, path: shot.path, ...(shot.dark_path ? { dark_path: shot.dark_path } : {}), ...(Object.keys(caption).length ? { caption } : {}) }
    })
  }
  return doc
}

/** The translated permission notes of a manifest, English left out. */
export function reasonsOf(manifest: Manifest | null): Record<string, Localized> | undefined {
  const out: Record<string, Localized> = {}
  for (const permission of Object.keys(manifest?.permission_reasons ?? {})) {
    for (const [locale, text] of Object.entries(manifest?.i18n ?? {})) {
      const value = text?.permission_reasons?.[permission]?.trim()
      if (value && locale !== 'en')
        (out[permission] ??= {})[locale] = value
    }
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * A document with the translated notes of the manifest under its own, so
 * the editor shows them; a document written before notes were part of it
 * holds none.
 */
export function withManifestReasons(doc: StoreDoc, manifest: Manifest | null): StoreDoc {
  const fromManifest = reasonsOf(manifest)
  if (!fromManifest)
    return doc
  const merged: Record<string, Localized> = {}
  for (const permission of new Set([...Object.keys(fromManifest), ...Object.keys(doc.permission_reasons ?? {})]))
    merged[permission] = { ...fromManifest[permission], ...doc.permission_reasons?.[permission] }
  return { ...doc, permission_reasons: merged }
}

/** A document without the notes that only repeat the manifest, as it is written. */
export function withoutManifestReasons(doc: StoreDoc, manifest: Manifest | null): StoreDoc {
  if (!doc.permission_reasons)
    return doc
  const own: Record<string, Localized> = {}
  for (const [permission, texts] of Object.entries(doc.permission_reasons)) {
    for (const [locale, text] of Object.entries(texts)) {
      if (text !== manifest?.i18n?.[locale]?.permission_reasons?.[permission])
        (own[permission] ??= {})[locale] = text
    }
  }
  const { permission_reasons: _, ...rest } = doc
  return Object.keys(own).length ? { ...rest, permission_reasons: own } : rest
}

async function raw(repo: string, ref: string, path: string): Promise<string | null> {
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/${path}`, { cf: { cacheTtl: 60 } } as RequestInit)
  return response.ok ? response.text() : null
}

async function rawJson<T>(repo: string, ref: string, path: string): Promise<T | null> {
  const text = await raw(repo, ref, path)
  if (text === null)
    return null
  try {
    return JSON.parse(text) as T
  }
  catch {
    return null
  }
}

/** The default branch of a repository resolved to its newest commit. */
export async function headOf(token: string, repo: string): Promise<{ branch: string, sha: string }> {
  return cached(`head:${repo.toLowerCase()}`, 60, async () => {
    const info = await github<{ default_branch: string }>(`/repos/${repo}`, token)
    const ref = await github<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(info.default_branch)}`, token)
    return { branch: info.default_branch, sha: ref.object.sha }
  })
}

export async function readStore(env: Env, token: string, opts: { id: string, repo: string | null, tag: string | null, entry: CatalogEntry | null }): Promise<StoreState> {
  const source = storeSourceOf(opts.entry?.store)
  const manifest = opts.repo && opts.tag ? await rawJson<Manifest>(opts.repo, opts.tag, 'plugin.json') : null
  if (source === 'catalog') {
    const [doc, readme] = await Promise.all([
      rawJson<StoreDoc>(env.CATALOG_REPO, 'main', `store/${opts.id}/store.json`),
      raw(env.CATALOG_REPO, 'main', `store/${opts.id}/README.md`),
    ])
    return { source, repo: env.CATALOG_REPO, ref: 'main', doc: withManifestReasons(doc ?? {}, manifest), readme, manifest, tag: opts.tag }
  }
  if (source === 'repo-branch' || source === 'repo-release') {
    const ref = source === 'repo-branch' && opts.repo ? (await headOf(token, opts.repo)).sha : opts.tag
    const [doc, readme] = opts.repo && ref
      ? await Promise.all([rawJson<StoreDoc>(opts.repo, ref, 'plugin.store.json'), raw(opts.repo, ref, 'README.md')])
      : [null, null]
    return { source, repo: opts.repo, ref, doc: withManifestReasons(doc ?? docFromManifest(manifest), manifest), readme, manifest, tag: opts.tag }
  }
  const readme = opts.repo && opts.tag ? await raw(opts.repo, opts.tag, 'README.md') : null
  return { source, repo: opts.repo, ref: opts.tag, doc: docFromManifest(manifest), readme, manifest, tag: opts.tag }
}

const SCREENSHOT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/
const MEDIA_PATH = /^media:[0-9a-f]{64}$/
const REPO_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+\.(?:png|jpe?g|webp)$/

function cleanLocalized(value: unknown, max: number, field: string, problems: string[]): Localized | undefined {
  if (value === undefined || value === null)
    return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${field}: not a text by language`)
    return undefined
  }
  const out: Localized = {}
  for (const [locale, text] of Object.entries(value as Record<string, unknown>)) {
    if (!(HOST_LOCALES as readonly string[]).includes(locale)) {
      problems.push(`${field}.${locale}: not a language of Nginx UI`)
      continue
    }
    if (typeof text !== 'string')
      continue
    const trimmed = text.trim()
    if (!trimmed)
      continue
    if (trimmed.length > max)
      problems.push(`${field}.${locale}: longer than ${max} characters`)
    out[locale] = trimmed.slice(0, max)
  }
  return Object.keys(out).length ? out : undefined
}

/** A document from the browser, cleaned, with what is wrong with it. */
export function cleanDoc(input: unknown): { doc: StoreDoc, problems: string[] } {
  const problems: string[] = []
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const doc: StoreDoc = {}
  const name = cleanLocalized(value.name, LIMITS.name, 'name', problems)
  const description = cleanLocalized(value.description, LIMITS.description, 'description', problems)
  if (name) {
    doc.name = name
    for (const [locale, text] of Object.entries(name)) {
      const word = reservedWord(text)
      if (word)
        problems.push(`name.${locale}: holds ${word}`)
    }
  }
  if (description)
    doc.description = description
  if (typeof value.homepage_url === 'string' && value.homepage_url.trim()) {
    const url = value.homepage_url.trim()
    if (!/^https:\/\/[^\s/]+/.test(url))
      problems.push('homepage_url: not an https address')
    else
      doc.homepage_url = url.slice(0, 500)
  }
  if (Array.isArray(value.screenshots)) {
    const seen = new Set<string>()
    const shots: StoreScreenshot[] = []
    for (const item of value.screenshots.slice(0, LIMITS.screenshots)) {
      const shot = (item ?? {}) as Record<string, unknown>
      const id = String(shot.id ?? '')
      const path = String(shot.path ?? '')
      if (!SCREENSHOT_ID.test(id) || seen.has(id)) {
        problems.push(`screenshots: id ${JSON.stringify(id)} is not valid or repeats`)
        continue
      }
      const pathOk = (p: string) => MEDIA_PATH.test(p) || REPO_PATH.test(p)
      if (!pathOk(path)) {
        problems.push(`screenshots.${id}: the image path is not valid`)
        continue
      }
      seen.add(id)
      const out: StoreScreenshot = { id, path }
      if (typeof shot.dark_path === 'string' && shot.dark_path) {
        if (pathOk(shot.dark_path))
          out.dark_path = shot.dark_path
        else
          problems.push(`screenshots.${id}: the dark image path is not valid`)
      }
      const caption = cleanLocalized(shot.caption, LIMITS.caption, `screenshots.${id}.caption`, problems)
      if (caption)
        out.caption = caption
      shots.push(out)
    }
    if (shots.length)
      doc.screenshots = shots
  }
  if (value.permission_reasons && typeof value.permission_reasons === 'object' && !Array.isArray(value.permission_reasons)) {
    const reasons: Record<string, Localized> = {}
    for (const [permission, texts] of Object.entries(value.permission_reasons as Record<string, unknown>).slice(0, 40)) {
      if (!PERMISSION.test(permission))
        continue
      const clean = cleanLocalized(texts, LIMITS.reason, `permission_reasons.${permission}`, problems)
      if (clean) {
        delete clean.en
        if (Object.keys(clean).length)
          reasons[permission] = clean
      }
    }
    if (Object.keys(reasons).length)
      doc.permission_reasons = reasons
  }
  return { doc, problems }
}

export interface StoreItem {
  field: string
  locale?: string
  label: string
  // Names go to review after the merge; everything else is live with it.
  review: boolean
}

/** What a draft changes against the current document, one item per text. */
export function diffDoc(before: StoreDoc, after: StoreDoc): StoreItem[] {
  const items: StoreItem[] = []
  for (const field of ['name', 'description'] as const) {
    const locales = new Set([...Object.keys(before[field] ?? {}), ...Object.keys(after[field] ?? {})])
    for (const locale of locales) {
      if ((before[field]?.[locale] ?? '') !== (after[field]?.[locale] ?? ''))
        items.push({ field, locale, label: `${field}.${locale}`, review: field === 'name' })
    }
  }
  if ((before.homepage_url ?? '') !== (after.homepage_url ?? ''))
    items.push({ field: 'homepage_url', label: 'homepage_url', review: false })
  const shotsBefore = new Map((before.screenshots ?? []).map(s => [s.id, s]))
  const shotsAfter = after.screenshots ?? []
  const order = (list: StoreScreenshot[] | undefined) => (list ?? []).map(s => s.id).join(',')
  if (order(before.screenshots) !== order(after.screenshots) && shotsBefore.size === shotsAfter.length && shotsAfter.every(s => shotsBefore.has(s.id)))
    items.push({ field: 'screenshots', label: 'screenshots.order', review: false })
  for (const shot of shotsAfter) {
    const old = shotsBefore.get(shot.id)
    if (!old) {
      items.push({ field: 'screenshots', label: `screenshots.${shot.id}.added`, review: false })
      continue
    }
    if (old.path !== shot.path || (old.dark_path ?? '') !== (shot.dark_path ?? ''))
      items.push({ field: 'screenshots', label: `screenshots.${shot.id}.image`, review: false })
    const locales = new Set([...Object.keys(old.caption ?? {}), ...Object.keys(shot.caption ?? {})])
    for (const locale of locales) {
      if ((old.caption?.[locale] ?? '') !== (shot.caption?.[locale] ?? ''))
        items.push({ field: 'caption', locale, label: `screenshots.${shot.id}.caption.${locale}`, review: false })
    }
  }
  for (const id of shotsBefore.keys()) {
    if (!shotsAfter.some(s => s.id === id))
      items.push({ field: 'screenshots', label: `screenshots.${id}.removed`, review: false })
  }
  for (const permission of new Set([...Object.keys(before.permission_reasons ?? {}), ...Object.keys(after.permission_reasons ?? {})])) {
    const a = before.permission_reasons?.[permission] ?? {}
    const b = after.permission_reasons?.[permission] ?? {}
    for (const locale of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((a[locale] ?? '') !== (b[locale] ?? ''))
        items.push({ field: 'permission_reasons', locale, label: `reason.${locale}.${permission}`, review: false })
    }
  }
  return items
}

/** Whether a translator, who edits texts only, could have made the change. */
export function textsOnly(before: StoreDoc, after: StoreDoc): boolean {
  if ((before.homepage_url ?? '') !== (after.homepage_url ?? ''))
    return false
  const a = before.screenshots ?? []
  const b = after.screenshots ?? []
  return a.length === b.length && a.every((s, i) => s.id === b[i].id && s.path === b[i].path && (s.dark_path ?? '') === (b[i].dark_path ?? ''))
}
