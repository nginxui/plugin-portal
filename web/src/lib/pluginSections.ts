import type { Router } from 'vue-router'
import { $gettext } from './gettext'

export interface PluginSection {
  key: string
  label: string
  to: string
}

// The sections of a plugin page in the order of the design; a section shows
// once its page exists.
export function pluginSections(router: Router, id: string): PluginSection[] {
  return [
    { key: 'plugin', label: $gettext('Store details'), path: '' },
    { key: 'plugin-screenshots', label: $gettext('Screenshots'), path: '/screenshots' },
    { key: 'plugin-translations', label: $gettext('Translations'), path: '/translations' },
    { key: 'plugin-preflight', label: $gettext('Release preflight'), path: '/preflight' },
    { key: 'plugin-versions', label: $gettext('Versions'), path: '/versions' },
    { key: 'plugin-badges', label: $gettext('Badges'), path: '/badges' },
    { key: 'plugin-signers', label: $gettext('Signers'), path: '/signers' },
    { key: 'plugin-access', label: $gettext('Access'), path: '/access' },
  ].filter(tab => router.hasRoute(tab.key)).map(tab => ({ key: tab.key, label: tab.label, to: `/plugins/${id}${tab.path}` }))
}
