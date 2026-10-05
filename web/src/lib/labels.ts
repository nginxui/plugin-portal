import type { Localized, PluginSummary, Role } from '@/api/plugins'
import gettext, { $gettext } from './gettext'

// The text of the current language, then English, then any.
export function localized(value: Localized | null | undefined): string {
  if (!value)
    return ''
  return value[gettext.current] ?? value.en ?? Object.values(value)[0] ?? ''
}

export function roleLabel(role: Role | null): string {
  switch (role) {
    case 'admin':
      return $gettext('Admin')
    case 'publisher':
      return $gettext('Publisher')
    case 'translator':
      return $gettext('Translator')
    default:
      return $gettext('No access')
  }
}

export function roleDescription(role: Role): string {
  switch (role) {
    case 'admin':
      return $gettext('Everything a publisher can do, plus organization actions such as the partner application and turning community translation on or off.')
    case 'publisher':
      return $gettext('Edit store data, manage versions and signers, and run preflight checks.')
    case 'translator':
      return $gettext('Edit store texts in every language and review community suggestions.')
  }
}

export function trustLabel(trust: string | null): string {
  switch (trust) {
    case 'official':
      return $gettext('Official')
    case 'verified':
      return $gettext('Partner')
    case 'community':
      return $gettext('Community')
    default:
      return ''
  }
}

export function stateTag(state: PluginSummary['state']): { label: string, color: string } {
  switch (state) {
    case 'listed':
      return { label: $gettext('Listed'), color: 'success' }
    case 'draft':
      return { label: $gettext('Draft'), color: 'default' }
    case 'delisted':
      return { label: $gettext('Delisted'), color: 'error' }
  }
}

export function storeSourceLabel(source: string): string {
  switch (source) {
    case 'repo-branch':
      return $gettext('Repository, following the default branch')
    case 'catalog':
      return $gettext('Hosted by the catalog')
    // Without a store field the document follows the release.
    default:
      return $gettext('Repository, following releases')
  }
}

export function storeSourceShort(source: string): string {
  switch (source) {
    case 'repo-branch':
      return $gettext('Repository, default branch')
    case 'catalog':
      return $gettext('Catalog hosted')
    default:
      return $gettext('Repository, with releases')
  }
}

/** Items of a list joined the way the language of the portal writes them. */
export function joinList(items: string[]): string {
  return items.join(gettext.current.startsWith('zh') ? '、' : ', ')
}

/** Clauses of a sentence joined the way the language of the portal writes them. */
export function joinClauses(items: string[]): string {
  return items.join(gettext.current.startsWith('zh') ? '，' : ', ')
}

/** Sentences one after another, with the space the language of the portal puts between them. */
export function joinSentences(items: (string | false | null | undefined)[]): string {
  return items.filter(Boolean).join(gettext.current.startsWith('zh') ? '' : ' ')
}

/** Two letters for an avatar: the first letters of the first two words, or the first two letters. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '?').split(/[\s._-]+/).filter(Boolean)
  const text = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)
  return text.toUpperCase()
}
