import type { StoreItem } from '@/api/store'
import type { PreviewDoc } from '@/components/MarketPreview.vue'
import { imageChanged } from './crop'
import gettext, { $gettext } from './gettext'
import { HOST_LOCALES } from './hostLocales'
import { localeName } from './locales'
import { permissionText } from './market'

// Whether a text in one language is new, taken out or only edited.
function textChange(before: string | undefined, after: string | undefined): { change?: 'added' | 'removed' } {
  if (!before)
    return { change: 'added' }
  if (!after)
    return { change: 'removed' }
  return {}
}

// The same comparison the Worker makes, so pending changes show while typing.
export function diffDoc(before: PreviewDoc, after: PreviewDoc): StoreItem[] {
  const items: StoreItem[] = []
  for (const field of ['name', 'description'] as const) {
    const locales = new Set([...Object.keys(before[field] ?? {}), ...Object.keys(after[field] ?? {})])
    for (const locale of locales) {
      if ((before[field]?.[locale] ?? '') !== (after[field]?.[locale] ?? ''))
        items.push({ field, locale, label: `${field}.${locale}`, review: field === 'name', ...textChange(before[field]?.[locale], after[field]?.[locale]) })
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
    if (imageChanged(was, shot))
      items.push({ field: 'screenshots', label: `screenshots.${shot.id}.image`, review: false })
    for (const locale of new Set([...Object.keys(was.caption ?? {}), ...Object.keys(shot.caption ?? {})])) {
      if ((was.caption?.[locale] ?? '') !== (shot.caption?.[locale] ?? ''))
        items.push({ field: 'caption', locale, label: `screenshots.${shot.id}.caption.${locale}`, review: false, ...textChange(was.caption?.[locale], shot.caption?.[locale]) })
    }
  }
  for (const id of old.keys()) {
    if (!now.some(s => s.id === id))
      items.push({ field: 'screenshots', label: `screenshots.${id}.removed`, review: false })
  }
  for (const permission of new Set([...Object.keys(before.permission_reasons ?? {}), ...Object.keys(after.permission_reasons ?? {})])) {
    const a = before.permission_reasons?.[permission] ?? {}
    const b = after.permission_reasons?.[permission] ?? {}
    for (const locale of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((a[locale] ?? '') !== (b[locale] ?? ''))
        items.push({ field: 'permission_reasons', locale, label: `reason.${locale}.${permission}`, review: false, ...textChange(a[locale], b[locale]) })
    }
  }
  return items
}

/** An item as an author reads it. */
export function itemLabel(item: StoreItem, doc: PreviewDoc): string {
  const lang = item.locale ? localeName(item.locale) : ''
  const parts = item.label.split('.')
  const index = (id: string) => String((doc.screenshots ?? []).findIndex(s => s.id === id) + 1 || id)
  // A text taken out says so, so a stale draft cannot remove one unnoticed.
  if (item.change === 'removed') {
    switch (item.field) {
      case 'name': return $gettext('Name in %{lang} removed', { lang })
      case 'description': return $gettext('Description in %{lang} removed', { lang })
      case 'caption': return $gettext('Caption of screenshot %{n} in %{lang} removed', { n: index(parts[1]), lang })
      case 'permission_reasons': return $gettext('Permission note %{name} in %{lang} removed', { name: permissionText(gettext.current, parts.slice(2).join('.')).label, lang })
    }
  }
  switch (item.field) {
    case 'name': return $gettext('Name in %{lang}', { lang })
    case 'description': return $gettext('Description in %{lang}', { lang })
    case 'homepage_url': return $gettext('Homepage')
    case 'caption': return $gettext('Caption of screenshot %{n} in %{lang}', { n: index(parts[1]), lang })
    case 'permission_reasons': return $gettext('Permission note %{name} in %{lang}', { name: permissionText(gettext.current, parts.slice(2).join('.')).label, lang })
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

/** How much of the store texts each language holds, from 0 to 1. */
export function coverageOf(doc: PreviewDoc): Record<string, number> {
  const texts = [doc.name, doc.description, ...(doc.screenshots ?? []).map(s => s.caption)].filter(t => t && Object.keys(t).length)
  const out: Record<string, number> = {}
  for (const locale of HOST_LOCALES)
    out[locale] = texts.length ? texts.filter(t => t![locale]).length / texts.length : 0
  return out
}
