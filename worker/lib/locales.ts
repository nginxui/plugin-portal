// The interface languages of Nginx UI, which store texts are translated into.
// English is the source every other language falls back to. The list follows
// the LINGUAS file of Nginx UI, so a language it adds can be translated here
// without a change; the portal's own interface languages are separate.

export const LINGUAS_URL = 'https://raw.githubusercontent.com/0xJacky/nginx-ui/main/app/src/language/LINGUAS'

// Used until LINGUAS is read, and the order known languages are shown in.
export const KNOWN_LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'de_DE', 'fr_FR', 'es', 'it_IT', 'pt_PT', 'ru_RU', 'uk_UA', 'tr_TR', 'vi_VN', 'ar']

// Filled in place, so code that imported it sees the current list.
export const HOST_LOCALES: string[] = [...KNOWN_LOCALES]

export type HostLocale = string

const LOCALE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/
const REFRESH_MS = 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000
let nextRefresh = 0
let pending: Promise<void> | null = null

export function isHostLocale(locale: string): locale is HostLocale {
  return HOST_LOCALES.includes(locale)
}

/** The locales a LINGUAS file lists: English first, then known ones in their order, then the rest. */
export function parseLinguas(text: string): string[] {
  const found = new Set(text.split(/\s+/).filter(item => LOCALE.test(item)))
  found.add('en')
  const known = KNOWN_LOCALES.filter(locale => found.has(locale))
  return [...known, ...[...found].filter(locale => !KNOWN_LOCALES.includes(locale))]
}

/** Whether LINGUAS was read, or tried, in this isolate. */
export function hostLocalesTried(): boolean {
  return nextRefresh > 0
}

/**
 * Reads LINGUAS again at most once an hour. A failed read keeps the list it had.
 * LINGUAS_URL "none" keeps the known list, for tests.
 */
export async function refreshHostLocales(env: { LINGUAS_URL?: string }, fetcher: typeof fetch = fetch): Promise<void> {
  if (Date.now() < nextRefresh || env.LINGUAS_URL === 'none')
    return
  pending ??= (async () => {
    try {
      const response = await fetcher(env.LINGUAS_URL || LINGUAS_URL, { signal: AbortSignal.timeout(3000) })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      const locales = parseLinguas(await response.text())
      if (locales.length < 2)
        throw new Error('LINGUAS lists no language')
      HOST_LOCALES.splice(0, HOST_LOCALES.length, ...locales)
      nextRefresh = Date.now() + REFRESH_MS
    }
    catch (error) {
      console.error('reading the languages of Nginx UI failed', error)
      nextRefresh = Date.now() + RETRY_MS
    }
    finally {
      pending = null
    }
  })()
  await pending
}

/** For tests: the known list again, read on the next refresh. */
export function resetHostLocales(): void {
  HOST_LOCALES.splice(0, HOST_LOCALES.length, ...KNOWN_LOCALES)
  nextRefresh = 0
}
