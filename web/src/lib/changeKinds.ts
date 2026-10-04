import { $gettext } from './gettext'

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'new_listing': return $gettext('New listing')
    case 'names': return $gettext('Name change')
    case 'key': return $gettext('Primary key rotation')
    case 'repository': return $gettext('Repository move')
    case 'delisting': return $gettext('Delisting')
    case 'yank': return $gettext('Yank a version')
    case 'unyank': return $gettext('Restore a version')
    case 'revoke_signer': return $gettext('Revoke a signer')
    case 'categories': return $gettext('Change categories')
    case 'batch': return $gettext('Batch change')
    default: return $gettext('Update')
  }
}
