// English names of the host languages, for prompts and messages.
const NAMES: Record<string, string> = {
  en: 'English',
  zh_CN: 'Simplified Chinese',
  zh_TW: 'Traditional Chinese',
  ja_JP: 'Japanese',
  ko_KR: 'Korean',
  de_DE: 'German',
  fr_FR: 'French',
  es: 'Spanish',
  pt_PT: 'European Portuguese',
  ru_RU: 'Russian',
  uk_UA: 'Ukrainian',
  tr_TR: 'Turkish',
  vi_VN: 'Vietnamese',
  ar: 'Arabic',
}

export function localeName(locale: string): string {
  return NAMES[locale] ?? locale
}
