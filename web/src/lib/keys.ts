import type { Draft } from '@/api/submit'

/** The key id of a pasted minisign public key, or null. */
export function publicKeyId(text: string): string | null {
  const line = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('untrusted comment:')).at(-1) ?? ''
  if (!/^RW[A-Z0-9+/]{54}$/i.test(line))
    return null
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(line), c => c.charCodeAt(0))
  }
  catch {
    return null
  }
  if (bytes.length !== 42)
    return null
  let id = ''
  for (let i = 9; i >= 2; i--)
    id += bytes[i].toString(16).padStart(2, '0')
  return id.toUpperCase()
}

export type KeyState = 'empty' | 'invalid' | 'signing' | 'mismatch' | 'match' | 'unchecked'

/** How a pasted primary public key relates to the certificate of the release. */
export function keyState(text: string, signer: Draft['signer']): { state: KeyState, id: string | null } {
  if (!text.trim())
    return { state: 'empty', id: null }
  const id = publicKeyId(text)
  if (!id)
    return { state: 'invalid', id: null }
  if (!signer?.primaryKeyId)
    return { state: 'unchecked', id }
  if (id === signer.signingKeyId)
    return { state: 'signing', id }
  return { state: id === signer.primaryKeyId ? 'match' : 'mismatch', id }
}
