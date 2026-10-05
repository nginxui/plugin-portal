import type { Manifest, StoreDoc } from './store'
import { parseCertificateSignature, parsePublicKey, reservedWord } from './rules'
import { docFromManifest, imageChanged } from './store'

// Preflight (spec 10): what a branch, tag or commit would change against the
// listed release, before it is released. The same comparison orders the
// review queue and feeds the update dialog of the host.

export type Sign = 'add' | 'del' | 'mod'

export interface DiffRow {
  sign: Sign
  kind: string
  // A value to show in code, such as a permission or a host.
  subject: string
  from?: string
  to?: string
  // A note from the manifest, such as the author's reason for a permission.
  note?: string
  attention?: 'new' | 'affects_updates' | 'review' | 'left_out'
}

export interface PreflightCheck {
  key: string
  status: 'pass' | 'fail' | 'warn'
  params?: Record<string, string>
}

const DESCRIPTION_OFFICIAL = /nginx[\s_-]*ui/i
const OFFICIAL = /\bofficial(?:ly)?\b|(?<!非)官方|(?<!非)公式|オフィシャル|(?<!비)공식/i

function descriptionProblem(text: string): boolean {
  return text.split(/[.!?。！？\n]+/).some(sentence => DESCRIPTION_OFFICIAL.test(sentence) && OFFICIAL.test(sentence))
}

function setDiff(kind: string, before: string[] = [], after: string[] = [], notes: Record<string, string> = {}, attention?: DiffRow['attention']): DiffRow[] {
  const rows: DiffRow[] = []
  for (const item of after.filter(x => !before.includes(x)))
    rows.push({ sign: 'add', kind, subject: item, note: notes[item], attention })
  for (const item of before.filter(x => !after.includes(x)))
    rows.push({ sign: 'del', kind, subject: item })
  return rows
}

function settingsFields(manifest: Manifest | null): Record<string, { title?: string, default?: unknown }> {
  const schema = manifest?.settings_schema as { properties?: Record<string, { title?: string, default?: unknown }> } | null | undefined
  return schema?.properties ?? {}
}

/** Compares a manifest at a ref with the listed one. */
export function runtimeDiff(listed: Manifest | null, next: Manifest | null) {
  const permissions = setDiff('permission', listed?.permissions, next?.permissions, next?.permission_reasons ?? {}, 'new')
  const hosts = setDiff('network_host', listed?.network_hosts, next?.network_hosts, {}, 'new')
  const capabilities = setDiff('capability', listed?.capabilities, next?.capabilities)
  const compatibility: DiffRow[] = []
  if ((listed?.min_nginx_ui_version ?? '') !== (next?.min_nginx_ui_version ?? ''))
    compatibility.push({ sign: 'mod', kind: 'min_nginx_ui_version', subject: 'min_nginx_ui_version', from: listed?.min_nginx_ui_version ?? '', to: next?.min_nginx_ui_version ?? '', attention: 'affects_updates' })
  const before = settingsFields(listed)
  const after = settingsFields(next)
  for (const key of Object.keys(after)) {
    if (!(key in before))
      compatibility.push({ sign: 'add', kind: 'setting', subject: key, note: after[key].title })
    else if (JSON.stringify(before[key].default) !== JSON.stringify(after[key].default))
      compatibility.push({ sign: 'mod', kind: 'setting_default', subject: key, from: JSON.stringify(before[key].default ?? null), to: JSON.stringify(after[key].default ?? null) })
  }
  for (const key of Object.keys(before)) {
    if (!(key in after))
      compatibility.push({ sign: 'del', kind: 'setting', subject: key })
  }
  compatibility.push(...setDiff('conflict', listed?.conflicts, next?.conflicts))
  return { permissions: [...permissions, ...hosts], capabilities, compatibility }
}

/** Compares store texts at a ref with the listed ones. */
export function storeDiff(listed: StoreDoc, next: StoreDoc): DiffRow[] {
  const rows: DiffRow[] = []
  for (const [locale, text] of Object.entries(next.name ?? {})) {
    const was = listed.name?.[locale]
    if (was !== text)
      rows.push({ sign: was ? 'mod' : 'add', kind: 'name', subject: locale, from: was, to: text, attention: reservedWord(text) ? 'left_out' : 'review' })
  }
  for (const [locale, text] of Object.entries(next.description ?? {})) {
    const was = listed.description?.[locale]
    if (was !== text)
      rows.push({ sign: was ? 'mod' : 'add', kind: 'description', subject: locale, attention: descriptionProblem(text) ? 'left_out' : undefined })
  }
  const before = new Map((listed.screenshots ?? []).map(s => [s.id, s]))
  for (const shot of next.screenshots ?? []) {
    const was = before.get(shot.id)
    if (!was)
      rows.push({ sign: 'add', kind: 'screenshot', subject: shot.id, to: shot.caption?.en })
    else if (imageChanged(was, shot))
      rows.push({ sign: 'mod', kind: 'screenshot', subject: shot.id, to: shot.caption?.en })
  }
  for (const id of before.keys()) {
    if (!(next.screenshots ?? []).some(s => s.id === id))
      rows.push({ sign: 'del', kind: 'screenshot', subject: id })
  }
  return rows
}

function semverParts(v: string): number[] {
  return v.replace(/^v/, '').split(/[-+]/)[0].split('.').map(n => Number(n) || 0)
}

export function newer(a: string, b: string): boolean {
  const x = semverParts(a)
  const y = semverParts(b)
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i])
      return x[i] > y[i]
  }
  return a.includes('-') ? false : b.includes('-')
}

/** The checks a ref must pass to be listed when released. */
export function preflightChecks(opts: {
  id: string
  listedVersion: string | null
  // Versions the repository has released already.
  released?: string[]
  // Official plugins are signed with the Nginx UI key and carry no certificate.
  official?: boolean
  manifest: Manifest | null
  primaryKey: string | null
  certificate: string | null
  certificateSignature: string | null
  images: { id: string, problem: string }[]
}): PreflightCheck[] {
  const checks: PreflightCheck[] = []
  const m = opts.manifest
  if (!m) {
    checks.push({ key: 'manifest', status: 'fail', params: { reason: 'missing' } })
  }
  else if (m.id !== opts.id) {
    checks.push({ key: 'manifest', status: 'fail', params: { reason: 'id', id: String(m.id ?? '') } })
  }
  else if (m.version && opts.released?.includes(m.version)) {
    checks.push({ key: 'manifest', status: 'fail', params: { reason: 'released', version: m.version } })
  }
  else if (!m.version || (opts.listedVersion && !newer(m.version, opts.listedVersion))) {
    checks.push({ key: 'manifest', status: 'fail', params: { reason: 'version', version: String(m.version ?? ''), listed: opts.listedVersion ?? '' } })
  }
  else {
    checks.push({ key: 'manifest', status: 'pass', params: { version: m.version } })
  }
  const primary = opts.primaryKey ? parsePublicKey(opts.primaryKey) : null
  const signature = opts.certificateSignature ? parseCertificateSignature(opts.certificateSignature) : null
  if (opts.official)
    checks.push({ key: 'signer', status: 'pass', params: { reason: 'official' } })
  else if (!opts.certificate || !signature)
    checks.push({ key: 'signer', status: 'warn', params: { reason: 'missing' } })
  else if (signature.pluginId !== opts.id)
    checks.push({ key: 'signer', status: 'fail', params: { reason: 'other_plugin', id: signature.pluginId ?? '' } })
  else if (primary && signature.primaryKeyId !== primary.id)
    checks.push({ key: 'signer', status: 'fail', params: { reason: 'other_key', key: signature.primaryKeyId } })
  else
    checks.push({ key: 'signer', status: 'pass', params: { key: signature.primaryKeyId } })
  for (const image of opts.images)
    checks.push({ key: 'screenshot', status: 'fail', params: { id: image.id, problem: image.problem } })
  return checks
}

export { docFromManifest }
