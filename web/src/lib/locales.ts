// Native names of the languages Nginx UI ships, which catalog texts use.
export const localeNames: Record<string, string> = {
  en: 'English',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
  ja_JP: '日本語',
  ko_KR: '한국어',
  de_DE: 'Deutsch',
  fr_FR: 'Français',
  es: 'Español',
  it_IT: 'Italiano',
  pt_PT: 'Português',
  ru_RU: 'Русский',
  uk_UA: 'Українська',
  tr_TR: 'Türkçe',
  vi_VN: 'Tiếng Việt',
  ar: 'العربية',
}

export function localeName(locale: string): string {
  return localeNames[locale] ?? locale
}
