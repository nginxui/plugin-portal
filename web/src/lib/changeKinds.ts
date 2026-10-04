import { $gettext } from './gettext'

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'new_listing': return $gettext('New listing')
    case 'names': return $gettext('Name change')
    case 'key': return $gettext('Primary key rotation')
    case 'repository': return $gettext('Repository move')
    case 'delisting': return $gettext('Delisting')
    default: return $gettext('Update')
  }
}
