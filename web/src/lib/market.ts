import { bundledText, describePermission, permissionLabel, trustText as trustWith } from '@nginxui/plugin-market-ui'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

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

export function installLabel(locale: string): string {
  return INSTALL[locale] ?? INSTALL.en
}

/** A trust level in the wording of Nginx UI, in the given language. */
export function trustText(locale: string, trust: string | null | undefined): string {
  return trust ? trustWith(bundledText(locale), trust).label : ''
}

/** A permission in the wording of Nginx UI, in the given language. */
export function permissionText(locale: string, permission: string): { label: string, description: string } {
  const t = bundledText(locale)
  return { label: permissionLabel(t, permission), description: describePermission(t, permission) }
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
