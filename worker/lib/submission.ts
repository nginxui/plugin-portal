import type { Env, Session } from '../env'
import type { Manifest } from './rules'
import { repoAccess } from './access'
import { loadCatalog } from './catalog'
import { github, GitHubError } from './github'
import { categoriesFromManifest, isSemver, manifestDescriptions, manifestNames, packageAssets, parseCertificateSignature, parsePublicKey, PLUGIN_ID, reservedWord, tagVersion } from './rules'

export type CheckStatus = 'pass' | 'fail' | 'warn'

export interface Check {
  key: string
  status: CheckStatus
  // A reason code the interface turns into text, with its parameters.
  reason?: string
  params?: Record<string, string>
}

export interface Draft {
  repo: string
  id: string
  name: Record<string, string>
  description: Record<string, string>
  version: string
  tag: string
  prerelease: boolean
  releaseUrl: string
  packages: string[]
  license: string | null
  categories: string[]
  readmeUrl: string
  // The signer certificate at the release tag, null when there is none.
  signer: { signingKeyId: string | null, primaryKeyId: string | null, pluginId: string | null } | null
}

export interface Preview {
  checks: Check[]
  draft: Draft | null
  ok: boolean
  // How the user may claim the repository, for the pull request.
  claim: string | null
}

interface RepoResponse {
  full_name: string
  private: boolean
  archived: boolean
  default_branch: string
  owner: { login: string, type: string }
  license: { spdx_id: string } | null
}

interface ReleaseResponse {
  tag_name: string
  prerelease: boolean
  draft: boolean
  html_url: string
  assets: { name: string }[]
}

const RAW = 'https://raw.githubusercontent.com'
const SETTINGS_SECONDS = 600

async function cachedJson<T>(url: string): Promise<T | null> {
  const cache = caches.default
  const hit = await cache.match(url)
  if (hit)
    return hit.json()
  const response = await fetch(url)
  if (!response.ok)
    return null
  const body = await response.text()
  await cache.put(url, new Response(body, { headers: { 'Cache-Control': `max-age=${SETTINGS_SECONDS}` } }))
  return JSON.parse(body)
}

export async function knownCategories(env: Env): Promise<string[]> {
  const schema = await cachedJson<{ $defs?: { category?: { enum?: string[] } } }>(`${RAW}/${env.CATALOG_REPO}/main/schema/entry.schema.json`)
  return schema?.$defs?.category?.enum ?? []
}

async function blocked(env: Env): Promise<{ plugins: string[], repositories: string[] }> {
  const list = await cachedJson<{ plugins?: string[], repositories?: string[] }>(`${RAW}/${env.CATALOG_REPO}/main/blocked.json`)
  return { plugins: list?.plugins ?? [], repositories: list?.repositories ?? [] }
}

const has = (list: string[], value: string) => list.some(item => item.toLowerCase() === value.toLowerCase())

async function rawFile(repo: string, ref: string, path: string): Promise<string | null> {
  const response = await fetch(`${RAW}/${repo}/${encodeURIComponent(ref)}/${path}`)
  return response.ok ? response.text() : null
}

/**
 * Checks a repository for submission and drafts what its listing shows. Every
 * check runs that can, so the author sees all problems at once.
 */
export async function previewSubmission(env: Env, session: Session, token: string, repoName: string): Promise<Preview> {
  const checks: Check[] = []
  const done = (draft: Draft | null = null, claim: string | null = null): Preview =>
    ({ checks, draft, claim, ok: draft !== null && checks.every(c => c.status !== 'fail') })

  if (!/^[\w.-]+\/[\w.-]+$/.test(repoName)) {
    checks.push({ key: 'repository', status: 'fail', reason: 'not_found' })
    return done()
  }
  let repo: RepoResponse
  try {
    repo = await github<RepoResponse>(`/repos/${repoName}`, token)
  }
  catch (error) {
    if (error instanceof GitHubError && (error.status === 404 || error.status === 403)) {
      checks.push({ key: 'repository', status: 'fail', reason: 'not_found' })
      return done()
    }
    throw error
  }
  const full = repo.full_name
  const lists = await blocked(env)
  if (repo.private)
    checks.push({ key: 'repository', status: 'fail', reason: 'private' })
  else if (has(lists.repositories, full))
    checks.push({ key: 'repository', status: 'fail', reason: 'blocked' })
  else if (repo.archived)
    checks.push({ key: 'repository', status: 'fail', reason: 'archived' })
  else
    checks.push({ key: 'repository', status: 'pass', params: { repo: full } })

  // Installing the Catalog App takes admin rights, and so does admin itself.
  const installed = await env.DB.prepare(
    'SELECT 1 FROM installations WHERE installed_by = ? AND repo_full_name = ? COLLATE NOCASE AND removed_at IS NULL LIMIT 1',
  ).bind(session.user.id, full).first()
  const access = await repoAccess(env, session.user.id, token, full, true)
  let claim: string | null = null
  if (installed)
    claim = `@${session.user.login} installed the NGINX UI Plugin Catalog app on ${full}`
  else if (access.permission === 'admin')
    claim = `@${session.user.login} has admin permission on ${full}`
  checks.push(claim
    ? { key: 'claim', status: 'pass', reason: installed ? 'installation' : 'admin' }
    : { key: 'claim', status: 'fail', reason: 'no_admin' })

  const releases = (await github<ReleaseResponse[]>(`/repos/${full}/releases?per_page=30`, token))
    .filter(r => !r.draft && isSemver(tagVersion(r.tag_name)))
  const release = releases.find(r => !r.prerelease) ?? releases[0]
  if (!release) {
    checks.push({ key: 'release', status: 'fail', reason: 'none' })
    return done(null, claim)
  }
  const version = tagVersion(release.tag_name)
  checks.push({ key: 'release', status: release.prerelease ? 'warn' : 'pass', reason: release.prerelease ? 'prerelease' : undefined, params: { version } })

  const text = await rawFile(full, release.tag_name, 'plugin.json')
  let manifest: Manifest
  try {
    if (!text)
      throw new Error('missing')
    manifest = JSON.parse(text)
  }
  catch {
    checks.push({ key: 'manifest', status: 'fail', reason: text ? 'invalid' : 'missing', params: { tag: release.tag_name } })
    return done(null, claim)
  }
  checks.push({ key: 'manifest', status: 'pass', params: { tag: release.tag_name } })

  const id = typeof manifest.id === 'string' ? manifest.id : ''
  const githubOwner = /^io\.github\.([a-z0-9-]+)\./.exec(id)?.[1]
  const catalog = await loadCatalog(env)
  const pending = id
    ? await env.DB.prepare(`SELECT id FROM changes WHERE plugin_id = ? AND kind = 'new_listing' AND state = 'open' LIMIT 1`).bind(id).first<{ id: string }>()
    : null
  let idReason: string | undefined
  if (!PLUGIN_ID.test(id) || id.length > 64)
    idReason = 'pattern'
  else if (id.startsWith('com.nginxui.'))
    idReason = 'reserved_namespace'
  else if (githubOwner && githubOwner !== repo.owner.login.toLowerCase())
    idReason = 'owner_mismatch'
  else if (has(lists.plugins, id))
    idReason = 'blocked'
  else if (catalog.plugins.some(p => p.id === id))
    idReason = 'listed'
  else if (pending)
    idReason = 'pending'
  checks.push(idReason
    ? { key: 'plugin_id', status: 'fail', reason: idReason, params: { id, owner: repo.owner.login } }
    : { key: 'plugin_id', status: 'pass', params: { id } })

  const english = typeof manifest.name === 'string' ? manifest.name.trim() : ''
  const translated = manifestNames(manifest)
  const word = reservedWord(english) || Object.values(translated).map(reservedWord).find(Boolean) || ''
  if (!english)
    checks.push({ key: 'name', status: 'fail', reason: 'missing' })
  else if (word)
    checks.push({ key: 'name', status: 'fail', reason: 'reserved', params: { word } })
  else
    checks.push({ key: 'name', status: 'pass', params: { name: english } })

  const packages = id ? packageAssets(release.assets, id, version) : []
  checks.push(packages.length
    ? { key: 'package', status: 'pass', params: { count: String(packages.length) } }
    : { key: 'package', status: 'fail', reason: 'missing', params: { name: `${id}-${version}.tar.gz` } })

  const [certificate, certificateSignature] = await Promise.all([
    rawFile(full, release.tag_name, 'plugin.signer'),
    rawFile(full, release.tag_name, 'plugin.signer.minisig'),
  ])
  let signer: Draft['signer'] = null
  if (certificate || certificateSignature) {
    const signed = certificateSignature ? parseCertificateSignature(certificateSignature) : null
    signer = {
      signingKeyId: certificate ? parsePublicKey(certificate)?.id ?? null : null,
      primaryKeyId: signed?.primaryKeyId ?? null,
      pluginId: signed?.pluginId ?? null,
    }
  }
  if (!signer?.signingKeyId || !signer.primaryKeyId)
    checks.push({ key: 'signer', status: 'warn', reason: 'missing', params: { tag: release.tag_name } })
  else if (id && signer.pluginId !== id)
    checks.push({ key: 'signer', status: 'fail', reason: 'other_plugin', params: { id: signer.pluginId ?? '' } })
  else
    checks.push({ key: 'signer', status: 'pass', params: { key: signer.primaryKeyId } })

  const license = repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null
  checks.push(license ? { key: 'license', status: 'pass', params: { license } } : { key: 'license', status: 'warn', reason: 'missing' })

  const draft: Draft = {
    repo: full,
    id,
    name: { en: english, ...translated },
    description: { ...(typeof manifest.description === 'string' && manifest.description.trim() ? { en: manifest.description.trim() } : {}), ...manifestDescriptions(manifest) },
    version,
    tag: release.tag_name,
    prerelease: release.prerelease,
    releaseUrl: release.html_url,
    packages,
    license,
    categories: categoriesFromManifest(manifest),
    readmeUrl: `${RAW}/${full}/${encodeURIComponent(release.tag_name)}/README.md`,
    signer,
  }
  return done(draft, claim)
}

export interface ReleaseInfo {
  signer: string | null
  version: string
  tag: string
  releasedAt: string | null
  url: string
  description: Record<string, string>
  minNginxUiVersion: string | null
}

/**
 * The releases a plugin's repository offers and what the newest one's
 * plugin.json says, for a plugin the published index does not list yet. The
 * catalog reads the same things when it builds.
 */
export async function repoReleases(token: string, repo: string): Promise<ReleaseInfo[]> {
  const releases = (await github<(ReleaseResponse & { published_at?: string })[]>(`/repos/${repo}/releases?per_page=10`, token).catch(() => []))
    .filter(r => !r.draft && isSemver(tagVersion(r.tag_name)))
  if (releases.length === 0)
    return []
  const newest = releases.find(r => !r.prerelease) ?? releases[0]
  let manifest: Manifest & { min_nginx_ui_version?: unknown } = {}
  try {
    manifest = JSON.parse(await rawFile(repo, newest.tag_name, 'plugin.json') ?? '{}')
  }
  catch {}
  const description = {
    ...(typeof manifest.description === 'string' && manifest.description.trim() ? { en: manifest.description.trim() } : {}),
    ...manifestDescriptions(manifest),
  }
  // The signing key of each release, from the certificate at its tag.
  const signers = await Promise.all(releases.map(async (r) => {
    const certificate = await rawFile(repo, r.tag_name, 'plugin.signer')
    return certificate ? parsePublicKey(certificate)?.id ?? null : null
  }))
  return releases.map((r, index) => ({
    signer: signers[index],
    version: tagVersion(r.tag_name),
    tag: r.tag_name,
    releasedAt: r.published_at ?? null,
    url: r.html_url,
    description: r === newest ? description : {},
    minNginxUiVersion: r === newest && typeof manifest.min_nginx_ui_version === 'string' ? manifest.min_nginx_ui_version : null,
  }))
}
