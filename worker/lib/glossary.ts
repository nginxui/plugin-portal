import type { Env } from '../env'
import { cached, store } from './cache'
import { HOST_LOCALES } from './locales'

// Terms as Nginx UI translates them, read from its gettext catalogs, so an AI
// draft of a plugin's texts uses the words of Nginx UI (spec 9).

const BASE = 'https://raw.githubusercontent.com/0xJacky/nginx-ui/dev/app/src/language'

// Interface labels such as "Access Log" or "DNS Credential": up to three
// capitalized words, with no punctuation and no status words, so messages
// like "Install successfully" stay out.
const LABEL = /^[A-Z][A-Za-z0-9]*(?: (?:[A-Z][A-Za-z0-9]*|[A-Z0-9]{2,}|of|and|for|to)){0,2}$/
const STATUS = /\b(?:Success|Successfully|Successful|Failed|Fail|Not|Invalid|Missing|Required)\b/

export function isTerm(msgid: string, msgstr: string): boolean {
  return LABEL.test(msgid) && !STATUS.test(msgid) && msgstr.trim() !== '' && msgstr !== msgid
}

/** The terms a text uses, longest first, so "Access Log" wins over "Log". */
export function termsIn(terms: Record<string, string>, text: string, limit = 40): [string, string][] {
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Object.entries(terms)
    .filter(([en]) => new RegExp(`\\b${escape(en)}(?:s|es)?\\b`, 'i').test(text))
    .sort((a, b) => b[0].length - a[0].length)
    .slice(0, limit)
}

/** msgid to msgstr of a .po file, single line and wrapped entries alike. */
export function parsePo(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const unquote = (lines: string[]) => lines.map(l => l.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\n/g, '\n')).join('')
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(l => !l.startsWith('#'))
    const id: string[] = []
    const str: string[] = []
    let target: string[] | null = null
    for (const line of lines) {
      if (line.startsWith('msgctxt')) {
        target = null
      }
      else if (line.startsWith('msgid ')) {
        target = id
        id.push(line.slice(6))
      }
      else if (line.startsWith('msgstr ')) {
        target = str
        str.push(line.slice(7))
      }
      else if (line.startsWith('"') && target) {
        target.push(line)
      }
    }
    const key = unquote(id)
    const value = unquote(str)
    if (key && value)
      out[key] = value
  }
  return out
}

async function fetchTerms(locale: string): Promise<Record<string, string>> {
  const response = await fetch(`${BASE}/${locale}.po`)
  if (!response.ok)
    return {}
  const catalog = parsePo(await response.text())
  return Object.fromEntries(Object.entries(catalog).filter(([id, str]) => isTerm(id, str)))
}

/** The terms in one language, English to the translation of Nginx UI. */
export async function glossary(locale: string): Promise<Record<string, string>> {
  if (locale === 'en' || !(HOST_LOCALES as readonly string[]).includes(locale))
    return {}
  return cached(`glossary:${locale}`, 2 * 86400, () => fetchTerms(locale))
}

/** Reads the terms of every language again; returns how many languages have any. */
export async function syncGlossary(env: Env): Promise<{ locales: number, syncedAt: number }> {
  let locales = 0
  for (const locale of HOST_LOCALES.filter(l => l !== 'en')) {
    const terms = await fetchTerms(locale).catch(() => ({}))
    if (Object.keys(terms).length) {
      locales++
      await store(`glossary:${locale}`, 2 * 86400, terms)
    }
  }
  const syncedAt = Math.floor(Date.now() / 1000)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO job_state (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').bind('glossary.synced', String(syncedAt)),
    env.DB.prepare('INSERT INTO job_state (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').bind('glossary.locales', String(locales)),
  ])
  return { locales, syncedAt }
}

/** When the terms were last read, and for how many languages. */
export async function glossaryState(env: Env): Promise<{ locales: number, syncedAt: number | null }> {
  const { results } = await env.DB.prepare(`SELECT name, value FROM job_state WHERE name IN ('glossary.synced', 'glossary.locales')`).all<{ name: string, value: string }>()
  const get = (name: string) => results.find(r => r.name === name)?.value
  return { locales: Number(get('glossary.locales') ?? 0), syncedAt: get('glossary.synced') ? Number(get('glossary.synced')) : null }
}
