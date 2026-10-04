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
