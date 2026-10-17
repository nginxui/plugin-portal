import { HOST_LOCALES } from './locales'

// Chinese is told apart by script, not by region.
const NAME_TAGS: Record<string, string> = { zh_CN: 'zh-Hans', zh_TW: 'zh-Hant' }
const english = new Intl.DisplayNames(['en'], { type: 'language' })

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

/** English name of a host language, for prompts and messages. */
export function localeName(locale: string): string {
  try {
    return english.of(NAME_TAGS[locale] ?? langTag(locale)) ?? locale
  }
  catch {
    return locale
  }
}
