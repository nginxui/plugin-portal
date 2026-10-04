import type { Env } from '../env'

// Screenshots uploaded through the studio (spec 7.3). The browser crops to
// 16:10 and encodes WebP; the Worker checks what it got and stores it by its
// digest, as a draft until a change publishes it.

export const MAX_BYTES = 2 * 1024 * 1024
export const MAX_SIDE = 3840

export function mediaEnabled(env: Env): boolean {
  return !!env.MEDIA
}

/** The size of a WebP image from its header, or null for anything else. */
export function webpSize(bytes: Uint8Array): { width: number, height: number } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP')
    return null
  const chunk = ascii(12, 16)
  if (chunk === 'VP8 ') {
    return { width: (bytes[26] | (bytes[27] << 8)) & 0x3FFF, height: (bytes[28] | (bytes[29] << 8)) & 0x3FFF }
  }
  if (chunk === 'VP8L') {
    const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]]
    return { width: 1 + (((b1 & 0x3F) << 8) | b0), height: 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)) }
  }
  if (chunk === 'VP8X') {
    return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) }
  }
  return null
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export const draftKey = (sha: string) => `drafts/${sha}.webp`
export const publishedKey = (sha: string) => `${sha}.webp`

/** Where a browser loads an image of a store document. */
export function imageUrl(env: Env, path: string, repo: string | null, ref: string | null): string | null {
  if (path.startsWith('media:')) {
    const sha = path.slice(6)
    return `/api/media/${sha}`
  }
  if (!repo || !ref)
    return null
  return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/${path}`
}

/** The bytes of an uploaded image, published or still a draft. */
export async function mediaBytes(env: Env, sha: string): Promise<Uint8Array | null> {
  if (!env.MEDIA)
    return null
  const object = await env.MEDIA.get(publishedKey(sha)) ?? await env.MEDIA.get(draftKey(sha))
  return object ? new Uint8Array(await object.arrayBuffer()) : null
}

/** Copies the drafts a document names to their published keys. */
export async function publishMedia(env: Env, shas: string[]): Promise<string[]> {
  const missing: string[] = []
  if (!env.MEDIA)
    return shas
  for (const sha of new Set(shas)) {
    if (await env.MEDIA.head(publishedKey(sha)))
      continue
    const draft = await env.MEDIA.get(draftKey(sha))
    if (!draft) {
      missing.push(sha)
      continue
    }
    await env.MEDIA.put(publishedKey(sha), await draft.arrayBuffer(), {
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
    })
  }
  return missing
}

export function mediaShas(paths: (string | undefined)[]): string[] {
  return paths.filter((p): p is string => !!p && p.startsWith('media:')).map(p => p.slice(6))
}
