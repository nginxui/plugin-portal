import { $gettext } from './gettext'

/** The page of a change, by its number once it has one. */
export function changePath(change: { id: string, number?: number | null }, base = '/changes'): string {
  return `${base}/${change.number ?? change.id}`
}

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
    case 'store': return $gettext('Store change')
    case 'store_source': return $gettext('Store source move')
    case 'translations': return $gettext('Community translations')
    case 'trust': return $gettext('Trust change')
    case 'block': return $gettext('Block list entry')
    case 'partner': return $gettext('Partner change')
    case 'commercial': return $gettext('Commercial details')
    default: return $gettext('Update')
  }
}
