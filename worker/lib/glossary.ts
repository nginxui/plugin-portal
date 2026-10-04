import { cached } from './cache'
import { HOST_LOCALES } from './locales'

// Terms as Nginx UI translates them, read from its gettext catalogs, so an AI
// draft of a plugin's texts uses the host's words (spec 9).

const BASE = 'https://raw.githubusercontent.com/0xJacky/nginx-ui/dev/app/src/language'

export const TERMS = [
  'Site',
  'Sites',
  'Stream',
  'Upstream',
  'Certificate',
  'Certificates',
  'Access Log',
  'Error Log',
  'Configuration',
  'Config',
  'Node',
  'Nodes',
  'Backup',
  'Notification',
  'Notifications',
  'Plugin',
  'Plugins',
  'Marketplace',
  'Template',
  'Templates',
  'Reload',
  'Restart',
  'Dashboard',
  'Settings',
  'Domain',
  'DNS Credential',
  'Environment',
  'Terminal',
  'Upgrade',
  'Install',
  'Enable',
  'Disable',
  'Log',
  'Logs',
  'Analytics',
  'Blocklist',
  'Monitoring',
]

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

/** The terms in one language, English to the host's translation. */
export async function glossary(locale: string): Promise<Record<string, string>> {
  if (locale === 'en' || !(HOST_LOCALES as readonly string[]).includes(locale))
    return {}
  return cached(`glossary:${locale}`, 86400, async () => {
    const response = await fetch(`${BASE}/${locale}.po`)
    if (!response.ok)
      return {}
    const catalog = parsePo(await response.text())
    return Object.fromEntries(TERMS.filter(t => catalog[t]).map(t => [t, catalog[t]]))
  })
}
