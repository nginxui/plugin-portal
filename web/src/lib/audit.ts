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
