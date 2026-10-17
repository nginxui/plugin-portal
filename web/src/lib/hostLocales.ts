// The interface languages of Nginx UI. Store texts are translated into these;
// a language a plugin leaves out shows English. The Worker follows the LINGUAS
// file of Nginx UI, and the list is loaded before the app mounts.

export const KNOWN_LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'de_DE', 'fr_FR', 'es', 'it_IT', 'pt_PT', 'ru_RU', 'uk_UA', 'tr_TR', 'vi_VN', 'ar']

const RTL_LANGUAGES = new Set(['ar', 'ckb', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi'])

// Filled in place, so code that imported them sees the loaded lists.
export const HOST_LOCALES: string[] = [...KNOWN_LOCALES]
export const RTL_LOCALES: string[] = KNOWN_LOCALES.filter(isRtl)

export function isRtl(locale: string): boolean {
  return RTL_LANGUAGES.has(locale.split('_')[0])
}

/** Loads the current list; the known one stays when the Worker cannot be reached. */
export async function loadHostLocales(): Promise<void> {
  try {
    const response = await fetch('/api/locales', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) })
    if (!response.ok)
      return
    const { locales } = await response.json() as { locales?: unknown }
    if (!Array.isArray(locales) || !locales.every(l => typeof l === 'string') || !locales.includes('en'))
      return
    HOST_LOCALES.splice(0, HOST_LOCALES.length, ...locales)
    RTL_LOCALES.splice(0, RTL_LOCALES.length, ...locales.filter(isRtl))
  }
  catch {}
}
