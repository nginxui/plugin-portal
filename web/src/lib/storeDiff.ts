import type { StoreItem } from '@/api/store'
import type { PreviewDoc } from '@/components/MarketPreview.vue'
import gettext, { $gettext } from './gettext'
import { HOST_LOCALES } from './hostLocales'
import { localeName } from './locales'
import { permissionText } from './market'

// The same comparison the Worker makes, so pending changes show while typing.
export function diffDoc(before: PreviewDoc, after: PreviewDoc): StoreItem[] {
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
  const old = new Map((before.screenshots ?? []).map(s => [s.id, s]))
  const now = after.screenshots ?? []
  if ((before.screenshots ?? []).map(s => s.id).join() !== now.map(s => s.id).join() && old.size === now.length && now.every(s => old.has(s.id)))
    items.push({ field: 'screenshots', label: 'screenshots.order', review: false })
  for (const shot of now) {
    const was = old.get(shot.id)
    if (!was) {
      items.push({ field: 'screenshots', label: `screenshots.${shot.id}.added`, review: false })
      continue
    }
    if (was.path !== shot.path || (was.dark_path ?? '') !== (shot.dark_path ?? ''))
      items.push({ field: 'screenshots', label: `screenshots.${shot.id}.image`, review: false })
    for (const locale of new Set([...Object.keys(was.caption ?? {}), ...Object.keys(shot.caption ?? {})])) {
      if ((was.caption?.[locale] ?? '') !== (shot.caption?.[locale] ?? ''))
        items.push({ field: 'caption', locale, label: `screenshots.${shot.id}.caption.${locale}`, review: false })
    }
  }
  for (const id of old.keys()) {
    if (!now.some(s => s.id === id))
      items.push({ field: 'screenshots', label: `screenshots.${id}.removed`, review: false })
  }
  return items
}

/** An item as an author reads it. */
export function itemLabel(item: StoreItem, doc: PreviewDoc): string {
  const lang = item.locale ? localeName(item.locale) : ''
  const parts = item.label.split('.')
  const index = (id: string) => String((doc.screenshots ?? []).findIndex(s => s.id === id) + 1 || id)
  switch (item.field) {
    case 'name': return $gettext('Name in %{lang}', { lang })
    case 'description': return $gettext('Description in %{lang}', { lang })
    case 'homepage_url': return $gettext('Homepage')
    case 'caption': return $gettext('Caption of screenshot %{n} in %{lang}', { n: index(parts[1]), lang })
    case 'runtime': return $gettext('Permission note %{name} in %{lang}', { name: permissionText(gettext.current, parts.slice(2).join('.')).label, lang })
    default:
      if (parts[1] === 'order')
        return $gettext('Order of the screenshots')
      if (parts[2] === 'added')
        return $gettext('New screenshot %{n}', { n: index(parts[1]) })
      if (parts[2] === 'removed')
        return $gettext('Removed screenshot %{id}', { id: parts[1] })
      return $gettext('Image of screenshot %{n}', { n: index(parts[1]) })
  }
}

/** What a draft of runtime strings changes against the manifest. */
export function diffRuntime(manifest: { i18n?: Record<string, { permission_reasons?: Record<string, string> }> } | null | undefined, runtime: Record<string, Record<string, string>>): StoreItem[] {
  const items: StoreItem[] = []
  for (const [locale, texts] of Object.entries(runtime)) {
    for (const [permission, text] of Object.entries(texts)) {
      if (text !== (manifest?.i18n?.[locale]?.permission_reasons?.[permission] ?? ''))
        items.push({ field: 'runtime', locale, label: `runtime.${locale}.${permission}`, review: false })
    }
  }
  return items
}

/** How much of the store texts each language holds, from 0 to 1. */
export function coverageOf(doc: PreviewDoc): Record<string, number> {
  const texts = [doc.name, doc.description, ...(doc.screenshots ?? []).map(s => s.caption)].filter(t => t && Object.keys(t).length)
  const out: Record<string, number> = {}
  for (const locale of HOST_LOCALES)
    out[locale] = texts.length ? texts.filter(t => t![locale]).length / texts.length : 0
  return out
}
