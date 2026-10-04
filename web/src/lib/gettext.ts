import { createGettext } from 'vue3-gettext'
import zhCN from '@/language/zh_CN.po'

export const languages: Record<string, string> = {
  en: 'English',
  zh_CN: '简体中文',
}

const STORAGE_KEY = 'portal-language'

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && saved in languages)
      return saved
  }
  catch {}
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en'
}

const gettext = createGettext({
  availableLanguages: languages,
  defaultLanguage: initialLanguage(),
  translations: { zh_CN: zhCN },
  silent: true,
})

export function setLanguage(language: string) {
  gettext.current = language
  document.documentElement.lang = language.replace('_', '-')
  try {
    localStorage.setItem(STORAGE_KEY, language)
  }
  catch {}
}

export const { $gettext, $pgettext, $ngettext } = gettext

export default gettext
