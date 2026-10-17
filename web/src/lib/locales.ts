import { HOST_LOCALES } from './hostLocales'

// Chinese is told apart by script, not by region.
const NAME_TAGS: Record<string, string> = { zh_CN: 'zh-Hans', zh_TW: 'zh-Hant' }
const names = new Map<string, string>()

/** The BCP 47 tag of a locale, without the region when it is the usual one of the language. */
export function langTag(locale: string, locales: readonly string[] = HOST_LOCALES): string {
  const [language, region] = locale.split('_')
  if (!region)
    return language
  const shared = locales.filter(other => other.split('_')[0] === language).length > 1
  if (!shared && new Intl.Locale(language).maximize().region === region)
    return language
  return `${language}-${region}`
}

/** Native name of a language Nginx UI ships, which catalog texts use. */
export function localeName(locale: string): string {
  let name = names.get(locale)
  if (name === undefined) {
    try {
      const tag = langTag(locale)
      const raw = new Intl.DisplayNames([tag], { type: 'language' }).of(NAME_TAGS[locale] ?? tag) ?? locale
      name = raw.charAt(0).toLocaleUpperCase(tag) + raw.slice(1)
    }
    catch {
      name = locale
    }
    names.set(locale, name)
  }
  return name
}
