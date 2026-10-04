// The interface languages of Nginx UI, which store texts are translated into.
// English is the source every other language falls back to.
export const HOST_LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'de_DE', 'fr_FR', 'es', 'pt_PT', 'ru_RU', 'uk_UA', 'tr_TR', 'vi_VN', 'ar'] as const

export type HostLocale = typeof HOST_LOCALES[number]

export function isHostLocale(locale: string): locale is HostLocale {
  return (HOST_LOCALES as readonly string[]).includes(locale)
}
