import type { Env } from '../env'
import { cached } from './cache'
import { github } from './github'

// Partner files of the catalog, partners/<name>.json, read from its main
// branch: the profile and key a partner page shows.

export interface PartnerFile {
  name: string
  public_key: string
  expires?: string
  revoked?: boolean
  reason?: string
  display_name?: string
  kind?: 'github_organization' | 'vendor'
  github_owner?: string
  homepage_url?: string
  description?: string
  logo_url?: string
}

export async function loadPartners(env: Env, token: string | null): Promise<PartnerFile[]> {
  return cached(`partners:${env.CATALOG_REPO}`, 300, async () => {
    const listing = await github<{ name: string, type: string }[]>(`/repos/${env.CATALOG_REPO}/contents/partners`, token).catch(() => [])
    const files = listing.filter(f => f.type === 'file' && f.name.endsWith('.json'))
    const out: PartnerFile[] = []
    for (const file of files) {
      const response = await fetch(`https://raw.githubusercontent.com/${env.CATALOG_REPO}/main/partners/${file.name}`)
      if (response.ok)
        out.push(await response.json() as PartnerFile)
    }
    return out
  })
}

/** The key id of a minisign public key, as minisign prints it. */
export function keyIdOf(publicKey: string): string | null {
  const line = publicKey.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('untrusted comment:')).at(-1) ?? ''
  try {
    const bytes = Uint8Array.from(atob(line), c => c.charCodeAt(0))
    if (bytes.length !== 42)
      return null
    return [...bytes.subarray(2, 10)].reverse().map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  catch {
    return null
  }
}
