import type { StoreItem } from './store'
import { github, GitHubError } from './github'
import { isHostLocale } from './locales'

// Runtime strings: texts of plugin.json the host shows while the plugin
// runs, so far the notes that explain each permission. They ship with the
// next release, so the portal writes them into plugin.json of the
// repository, never into the catalog.

/** Translations by locale and permission, English left out. */
export type RuntimeTexts = Record<string, Record<string, string>>

interface Manifest {
  permission_reasons?: Record<string, string>
  i18n?: Record<string, { permission_reasons?: Record<string, string> } & Record<string, unknown>>
}

export const RUNTIME_LIMIT = 300
const PERMISSION = /^[a-z][a-z0-9._-]{0,47}$/

/** Keeps known permissions of host locales, text trimmed; an empty text removes one. */
export function cleanRuntime(input: unknown, manifest: Manifest | null): RuntimeTexts {
  // Without the manifest at hand only the shape of a permission is checked.
  const known = manifest ? new Set(Object.keys(manifest.permission_reasons ?? {})) : null
  const out: RuntimeTexts = {}
  if (!input || typeof input !== 'object')
    return out
  for (const [locale, texts] of Object.entries(input as Record<string, unknown>)) {
    if (!isHostLocale(locale) || locale === 'en' || !texts || typeof texts !== 'object')
      continue
    for (const [permission, text] of Object.entries(texts as Record<string, unknown>)) {
      if ((known ? !known.has(permission) : !PERMISSION.test(permission)) || typeof text !== 'string')
        continue
      out[locale] ??= {}
      out[locale][permission] = text.trim().slice(0, RUNTIME_LIMIT)
    }
  }
  return out
}

/** What a draft changes against the manifest, one item per text. */
export function diffRuntime(manifest: Manifest | null, runtime: RuntimeTexts | undefined): StoreItem[] {
  const items: StoreItem[] = []
  for (const [locale, texts] of Object.entries(runtime ?? {})) {
    for (const [permission, text] of Object.entries(texts)) {
      if (text !== (manifest?.i18n?.[locale]?.permission_reasons?.[permission] ?? ''))
        items.push({ field: 'runtime', locale, label: `runtime.${locale}.${permission}`, review: false })
    }
  }
  return items
}

/** The text of plugin.json with the translations merged in, indented as it was. */
export function mergeRuntime(text: string, runtime: RuntimeTexts): string {
  const manifest = JSON.parse(text) as Manifest & Record<string, unknown>
  for (const [locale, texts] of Object.entries(runtime)) {
    const i18n = (manifest.i18n ??= {})
    const entry = (i18n[locale] ??= {})
    const reasons = { ...(entry.permission_reasons ?? {}) }
    for (const [permission, value] of Object.entries(texts)) {
      if (value)
        reasons[permission] = value
      else
        delete reasons[permission]
    }
    if (Object.keys(reasons).length)
      entry.permission_reasons = reasons
    else
      delete entry.permission_reasons
    if (!Object.keys(entry).length)
      delete i18n[locale]
  }
  if (manifest.i18n && !Object.keys(manifest.i18n).length)
    delete manifest.i18n
  const indent = /\n(\s+)"/.exec(text)?.[1] ?? '  '
  return `${JSON.stringify(manifest, null, indent)}\n`
}

/** plugin.json at the root of the default branch, or null when there is none. */
export async function repoManifest(token: string, repo: string): Promise<string | null> {
  try {
    const file = await github<{ content: string, encoding: string }>(`/repos/${repo}/contents/plugin.json`, token)
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
  catch (error) {
    if (error instanceof GitHubError && error.status === 404)
      return null
    throw error
  }
}
