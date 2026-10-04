import { $gettext } from './gettext'

// The check runs of the catalog repository's workflows by their meaning. A run
// named "<workflow job> / <job>" is matched by its last part; unknown runs
// keep their name.
export function checkRunLabel(name: string): string {
  const last = name.split(' / ').at(-1)?.trim() ?? name
  switch (last) {
    case 'Schema and structural checks': return $gettext('Entry format and structure')
    case 'Releases, packages and lint': return $gettext('Releases, packages and lint')
    case 'Draft the entry': return $gettext('Drafting the entry')
    case 'Check the entry': return $gettext('Checking the entry')
    default: return name
  }
}
