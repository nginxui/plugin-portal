import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { MARKET_CAPABILITIES, MARKET_CATEGORIES, MARKET_CREDENTIALS, MARKET_LABELS, MARKET_PERMISSIONS, MARKET_UNKNOWN } from './marketStrings'

// How the store preview reads texts: in the preview language, falling back to
// English as Nginx UI does.

export type Stress = 'off' | 'longest' | 'rtl'

export interface Localized { [locale: string]: string }

export interface Resolved {
  text: string
  // The text is English standing in for the preview language.
  fallback: boolean
}

const INSTALL: Record<string, string> = {
  en: 'Install',
  zh_CN: '安装',
  zh_TW: '安裝',
  ja_JP: 'インストール',
  ko_KR: '설치',
  de_DE: 'Installieren',
  fr_FR: 'Installer',
  es: 'Instalar',
  pt_PT: 'Instalar',
  ru_RU: 'Установить',
  uk_UA: 'Встановити',
  tr_TR: 'Yükle',
  vi_VN: 'Cài đặt',
  ar: 'تثبيت',
}

export function resolve(value: Localized | undefined, locale: string): Resolved {
  if (!value)
    return { text: '', fallback: false }
  const own = value[locale]
  const text = own ?? value.en ?? Object.values(value)[0] ?? ''
  const fallback = !own && locale !== 'en' && !!text
  return { text, fallback }
}

/** A label of the preview chrome in the preview language. */
export function label(locale: string, key: string, value?: string): string {
  const table = MARKET_LABELS[locale] ?? MARKET_LABELS.en
  let text = String(table[key] ?? MARKET_LABELS.en[key] ?? key)
  if (value !== undefined)
    text = text.replace('{x}', value)
  return text
}

export function installLabel(locale: string): string {
  return INSTALL[locale] ?? INSTALL.en
}

export function trustText(locale: string, trust: string | null | undefined): string {
  const table = (MARKET_LABELS[locale] ?? MARKET_LABELS.en).trust as Record<string, string>
  return trust ? table[trust] ?? trust : ''
}

export function categoryText(locale: string, id: string): string {
  return MARKET_CATEGORIES[id]?.[locale] ?? MARKET_CATEGORIES[id]?.en ?? id
}

export function capabilityText(locale: string, id: string): string {
  return MARKET_CAPABILITIES[id]?.label[locale] ?? MARKET_CAPABILITIES[id]?.label.en ?? id
}

export function permissionText(locale: string, permission: string): { label: string, description: string } {
  const pick = (table: Record<string, string>) => table[locale] ?? table.en
  if (permission.startsWith('credentials.read:')) {
    const kind = permission.slice('credentials.read:'.length)
    return { label: pick(MARKET_CREDENTIALS.label).replace('{x}', kind), description: pick(MARKET_CREDENTIALS.description).replace('{x}', kind) }
  }
  const known = MARKET_PERMISSIONS[permission]
  return known
    ? { label: pick(known.label), description: pick(known.description) }
    : { label: pick(MARKET_UNKNOWN.label), description: pick(MARKET_UNKNOWN.description) }
}

/** README Markdown as safe HTML; relative images resolve against base. */
export function renderMarkdown(markdown: string | null | undefined, base?: string | null): string {
  if (!markdown)
    return ''
  const html = marked.parse(markdown, { async: false, gfm: true }) as string
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
  if (!base)
    return clean
  return clean.replace(/(<img[^>]+src=")(?!https?:|data:|\/)([^"]+)"/g, (_, head, src) => `${head}${base}/${src}"`)
}
