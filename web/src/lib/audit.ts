import type { AuditEntry, AuditKind } from '@/api/audit'
import { categoryLabel } from './categories'
import { $gettext } from './gettext'

export function auditKindLabel(kind: AuditKind): string {
  switch (kind) {
    case 'review': return $gettext('Review')
    case 'self_service': return $gettext('Self service')
    case 'submission': return $gettext('Submission')
    case 'system': return $gettext('System')
    case 'account': return $gettext('Sign in')
    case 'maintainer': return $gettext('Maintainer action')
    case 'ai': return $gettext('AI')
    case 'settings': return $gettext('Settings')
  }
}

export const AUDIT_KIND_COLORS: Record<AuditKind, string> = {
  review: 'blue',
  self_service: 'default',
  submission: 'cyan',
  system: 'default',
  account: 'default',
  maintainer: 'orange',
  ai: 'purple',
  settings: 'default',
}

function versions(list: string[]): string {
  return list.map(v => `v${v}`).join(', ')
}

function outcomeText(outcome: unknown, pr: unknown): string {
  switch (outcome) {
    case 'opened': return $gettext('Opened pull request #%{n} for review', { n: String(pr ?? '') })
    case 'committed': return $gettext('Committed the change to the catalog')
    case 'checks_failed': return $gettext('The checks found problems')
    case 'rejected': return $gettext('The change was refused by the catalog rules')
    case 'unsupported': return $gettext('The change is not supported yet')
    default: return $gettext('The checks could not finish')
  }
}

/** What a record did, one line per operation. */
export function auditLines(entry: AuditEntry): string[] {
  const d = entry.detail ?? {}
  const pr = String(d.pr ?? '')
  switch (entry.action) {
    case 'auth.sign_in': return [$gettext('Signed in')]
    case 'change.submit': return [$gettext('Submitted the plugin for review')]
    case 'change.applied': return [outcomeText(d.outcome, d.pr)]
    case 'catalog.deployed': return [$gettext('Published the catalog, %{n} changes went live', { n: String(d.live?.length ?? 0) })]
    case 'review.merge': return [$gettext('Approved and merged #%{n}', { n: pr })]
    case 'review.request_changes': return [$gettext('Requested changes on #%{n}', { n: pr })]
    case 'review.reject': return [$gettext('Rejected #%{n}', { n: pr })]
    case 'store.submit': return [$gettext('Submitted %{n} store changes', { n: String(d.items ?? 0) })]
    case 'community.decide': return [$gettext('Accepted %{a} and declined %{d} community translations', { a: String(d.accepted ?? 0), d: String(d.declined ?? 0) })]
    case 'community.enable': return [$gettext('Turned community translation on')]
    case 'community.disable': return [$gettext('Turned community translation off')]
    case 'ai.draft': return [$gettext('Drafted a translation into %{lang} with %{model}', { lang: String(d.locale ?? ''), model: String(d.model ?? '') })]
    case 'ai.provider_add': return [$gettext('Added the AI model %{name}', { name: entry.subject ?? '' })]
    case 'ai.provider_change': return [d.quota ? $gettext('Changed the AI model %{name}: drafts per author per day %{from} to %{to}', { name: entry.subject ?? '', from: String(d.quota.from), to: String(d.quota.to) }) : $gettext('Changed the AI model %{name}', { name: entry.subject ?? '' })]
    case 'ai.provider_remove': return [$gettext('Removed the AI model %{name}', { name: entry.subject ?? '' })]
    case 'ai.review': return [$gettext('Made an AI pre-review with %{n} findings', { n: String(d.findings ?? 0) })]
    case 'settings.announcement_create': return [$gettext('Published the announcement %{title}', { title: String(d.title ?? '') })]
    case 'settings.announcement_update': return [$gettext('Changed the announcement %{title}', { title: String(d.title ?? '') })]
    case 'settings.announcement_delete': return [$gettext('Removed the announcement %{title}', { title: String(d.title ?? '') })]
    case 'settings.mail': return [d.keyChanged ? $gettext('Set the mail service, sender %{from}, with a new key', { from: String(d.from ?? '') }) : $gettext('Set the mail service, sender %{from}', { from: String(d.from ?? '') })]
    case 'settings.mail_clear': return [$gettext('Removed the mail service settings')]
    case 'settings.bot': return [d.tokenChanged ? $gettext('Set the bot account @%{login} with a new token', { login: String(d.login ?? '') }) : $gettext('Set the bot account @%{login}', { login: String(d.login ?? '') })]
    case 'settings.bot_clear': return [$gettext('Removed the bot account settings')]
    case 'ai.glossary_sync': return [$gettext('Read the glossary again, %{n} languages', { n: String(d.locales ?? 0) })]
    case 'change.self_service': {
      const ops = (d.operations ?? {}) as { yank?: string[], unyank?: string[], revoke_signers?: string[], categories?: string[] }
      const lines: string[] = []
      if (ops.yank?.length)
        lines.push($gettext('Yanked %{versions}', { versions: versions(ops.yank) }))
      if (ops.unyank?.length)
        lines.push($gettext('Restored %{versions}', { versions: versions(ops.unyank) }))
      if (ops.revoke_signers?.length)
        lines.push($gettext('Revoked signer %{ids}', { ids: ops.revoke_signers.join(', ') }))
      if (ops.categories)
        lines.push($gettext('Set the categories to %{list}', { list: ops.categories.map(categoryLabel).join(', ') }))
      return lines.length ? lines : [entry.action]
    }
    default: return [entry.action]
  }
}

/** A reason or note kept with the record, if any. */
export function auditNote(entry: AuditEntry): string {
  const d = entry.detail ?? {}
  return typeof d.reason === 'string' ? d.reason : ''
}

/** The details of a record as readable lines, the known fields named. */
export function auditDetailLines(entry: AuditEntry): string[] {
  const d = (entry.detail ?? {}) as Record<string, unknown>
  const lines: string[] = []
  for (const [key, value] of Object.entries(d)) {
    if (value === null || value === undefined || value === '')
      continue
    switch (key) {
      case 'change':
        // Shown by its number when the change is known.
        lines.push($gettext('Change: %{id}', { id: entry.record?.url.startsWith('/changes/') ? entry.record.label : String(value) }))
        break
      case 'pr':
        lines.push($gettext('Pull request: #%{n}', { n: String(value) }))
        break
      case 'commit':
        lines.push($gettext('Commit: %{sha}', { sha: String(value).slice(0, 12) }))
        break
      case 'run':
        lines.push($gettext('Workflow run: %{id}', { id: String(value) }))
        break
      case 'reason':
        lines.push($gettext('Reason: %{reason}', { reason: String(value) }))
        break
      case 'outcome':
        lines.push(outcomeText(value, d.pr))
        break
      case 'live':
        lines.push($gettext('Went live: %{list}', { list: Array.isArray(value) && value.length ? value.join(', ') : $gettext('none') }))
        break
      case 'names':
        for (const [locale, name] of Object.entries(value as Record<string, string>))
          lines.push($gettext('Name in %{lang}: %{name}', { lang: locale, name }))
        break
      case 'operations':
        lines.push(...auditLines({ ...entry, action: 'change.self_service' }))
        break
      default:
        lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    }
  }
  return lines
}
