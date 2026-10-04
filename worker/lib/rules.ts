// Listing rules ported from nginxui/plugins (scripts/submission/core.mjs,
// scripts/ci/names.mjs, release-assets.mjs, semver.mjs, minisign.mjs). The
// portal uses them for its live preview only: apply.yml drafts the entry that
// is actually submitted with the catalog's own code, so a drift here shows a
// wrong preview but never lists anything.

export const PLUGIN_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/

const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*))*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i

export function tagVersion(tag: string): string {
  return tag.replace(/^v/, '')
}

export function isSemver(version: string): boolean {
  return SEMVER.test(version)
}

const RESERVED: { pattern: RegExp, word: string }[] = [
  { pattern: /[\p{Cc}\p{Cf}\u2028\u2029]/u, word: 'an invisible character' },
  { pattern: /\bofficial\b/i, word: 'official' },
  { pattern: /(?<!非)官方/, word: '官方' },
  { pattern: /(?<!非)公式/, word: '公式' },
  { pattern: /オフィシャル/, word: 'オフィシャル' },
  { pattern: /(?<!비)공식/, word: '공식' },
]

/** What a name holds that no name may, empty when it holds nothing such. */
export function reservedWord(name: string): string {
  return RESERVED.find(({ pattern }) => pattern.test(name))?.word ?? ''
}

const LOCALE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/

export interface Manifest {
  id?: unknown
  name?: unknown
  description?: unknown
  capabilities?: unknown
  content?: { templates?: unknown, locales?: unknown }
  i18n?: Record<string, { name?: unknown, description?: unknown }>
}

/** The translated names of a manifest, English left out. */
export function manifestNames(manifest: Manifest): Record<string, string> {
  const names: Record<string, string> = {}
  for (const [locale, text] of Object.entries(manifest.i18n ?? {})) {
    if (locale !== 'en' && LOCALE.test(locale) && typeof text?.name === 'string' && text.name.trim())
      names[locale] = text.name.trim()
  }
  return names
}

const CATEGORIES_BY_CAPABILITY: Record<string, string[]> = {
  'dns01': ['certificates', 'dns'],
  'cert.deploy': ['certificates'],
  'security.blocklist': ['security'],
  'upstream.discovery': ['traffic'],
  'probe': ['monitoring'],
  'log.sink': ['logs'],
  'notify': ['notifications'],
  'storage': ['backup'],
  'mcp': ['ai'],
}

export function categoriesFromManifest(manifest: Manifest): string[] {
  const categories = new Set<string>()
  for (const capability of Array.isArray(manifest.capabilities) ? manifest.capabilities : [])
    CATEGORIES_BY_CAPABILITY[capability]?.forEach(category => categories.add(category))
  if (manifest.content?.templates)
    categories.add('templates')
  if (manifest.content?.locales)
    categories.add('languages')
  return [...categories].slice(0, 3)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The package assets of a release: the portable one and per platform ones. */
export function packageAssets(assets: { name: string }[], id: string, version: string): string[] {
  const perPlatform = new RegExp(`^${escapeRegExp(id)}-${escapeRegExp(version)}-[a-z0-9]+-[a-z0-9]+\\.tar\\.gz$`)
  return assets.map(a => a.name).filter(name => name === `${id}-${version}.tar.gz` || perPlatform.test(name))
}

const PUBLIC_KEY_BYTES = 42

/** The key line and key id of a minisign public key, or null. */
export function parsePublicKey(text: string): { line: string, id: string } | null {
  const line = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('untrusted comment:')).at(-1) ?? ''
  if (!/^[A-Z0-9+/]+={0,2}$/i.test(line))
    return null
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(line), c => c.charCodeAt(0))
  }
  catch {
    return null
  }
  if (bytes.length !== PUBLIC_KEY_BYTES || bytes[0] !== 0x45 || bytes[1] !== 0x64)
    return null
  let id = ''
  for (let i = 9; i >= 2; i--)
    id += bytes[i].toString(16).padStart(2, '0')
  return { line, id: id.toUpperCase() }
}
