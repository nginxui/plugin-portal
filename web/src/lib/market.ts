import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { MARKET_CAPABILITIES, MARKET_CATEGORIES, MARKET_CREDENTIALS, MARKET_LABELS, MARKET_PERMISSIONS, MARKET_UNKNOWN } from './marketStrings'

// How the store preview reads texts: in the preview language, falling back to
// English as Nginx UI does, and transformed by the stress switch.

export type Stress = 'off' | 'longest' | 'rtl' | 'pseudo'

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

const ACCENTS: Record<string, string> = { a: 'á', b: 'ƀ', c: 'ç', d: 'đ', e: 'é', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', n: 'ñ', o: 'ö', r: 'ŕ', s: 'š', t: 'ţ', u: 'ü', w: 'ŵ', y: 'ý', z: 'ž', A: 'Á', C: 'Ç', E: 'É', G: 'Ĝ', I: 'Í', N: 'Ñ', O: 'Ö', S: 'Š', U: 'Ü' }

/** Pseudo localized: accented and a third longer, so clipped text shows. */
export function pseudo(text: string): string {
  const accented = [...text].map(c => ACCENTS[c] ?? c).join('')
  const pad = '~'.repeat(Math.max(2, Math.ceil(text.length / 3)))
  return `[${accented} ${pad}]`
}

export function resolve(value: Localized | undefined, locale: string, stress: Stress = 'off'): Resolved {
  if (!value)
    return { text: '', fallback: false }
  if (stress === 'longest') {
    const longest = Object.values(value).reduce((a, b) => (b.length > a.length ? b : a), '')
    return { text: longest, fallback: false }
  }
  const own = value[locale]
  const text = own ?? value.en ?? Object.values(value)[0] ?? ''
  const fallback = !own && locale !== 'en' && !!text
  return { text: stress === 'pseudo' ? pseudo(text) : text, fallback }
}

/** A label of the preview chrome in the preview language. */
export function label(locale: string, key: string, value?: string, stress: Stress = 'off'): string {
  const table = MARKET_LABELS[locale] ?? MARKET_LABELS.en
  let text = String(table[key] ?? MARKET_LABELS.en[key] ?? key)
  if (value !== undefined)
    text = text.replace('{x}', value)
  return stress === 'pseudo' ? pseudo(text) : text
}

export function installLabel(locale: string, stress: Stress = 'off'): string {
  const text = INSTALL[locale] ?? INSTALL.en
  return stress === 'pseudo' ? pseudo(text) : text
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
