const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64(text: string): Uint8Array {
  const normal = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4))
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

export async function sha256Hex(text: string): Promise<string> {
  return [...await sha256(text)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(await sha256(verifier))
}

export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length)
    return false
  let diff = 0
  for (let i = 0; i < left.length; i++)
    diff |= left[i] ^ right[i]
  return diff === 0
}

const keys = new Map<string, Promise<CryptoKey>>()

function importKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret)
  if (!key) {
    const raw = fromBase64(secret)
    if (raw.length !== 32)
      throw new Error('SESSION_KEY must be 32 bytes, base64 encoded')
    key = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
    keys.set(secret, key)
  }
  return key
}

// AES-GCM with a random nonce. The context is bound as additional data, so a
// value copied to another row does not decrypt.
export async function seal(secret: string, plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    await importKey(secret),
    encoder.encode(plain),
  )
  const out = new Uint8Array(iv.length + cipher.byteLength)
  out.set(iv)
  out.set(new Uint8Array(cipher), iv.length)
  return base64url(out)
}

export async function open(secret: string, sealed: string, context: string): Promise<string> {
  const data = fromBase64(sealed)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.slice(0, 12), additionalData: encoder.encode(context) },
    await importKey(secret),
    data.slice(12),
  )
  return decoder.decode(plain)
}
