import { api } from './client'

export type Stage = 'submitted' | 'checks' | 'review' | 'merged' | 'live'

export interface Change {
  number?: number | null
  id: string
  pluginId: string | null
  kind: string
  class: string
  state: 'draft' | 'open' | 'merged' | 'live' | 'rejected' | 'withdrawn' | 'failed'
  stage: Stage
  waitingOn: 'author' | 'maintainer' | 'system' | null
  prNumber: number | null
  prUrl: string | null
  commitSha: string | null
  commitUrl: string | null
  entry: { name?: Record<string, string>, repo?: string, version?: string } | null
  outcome: { outcome: string, message?: string, problems?: string, runUrl?: string | null } | null
  operations?: { yank?: string[], unyank?: string[], revoke_signers?: string[], categories?: string[], names?: Record<string, string> }
  reason?: string
  // A store change: where it went and what it holds.
  delivery?: 'catalog' | 'bot' | 'patch' | null
  repo?: string | null
  items?: { field: string, locale?: string, label: string, review: boolean, value?: string }[]
  patchUrl?: string
  // In the list of the user's changes: comments on the pull request and the
  // changes a maintainer asked for last.
  comments?: number | null
  askedFor?: string | null
  askedBy?: string | null
  askedAt?: number | null
  createdAt: number
  updatedAt: number
}

export interface ChangeEvent {
  stage: string
  actor: string | null
  at: number
  detail: { outcome?: string, prNumber?: number, retry?: boolean, commit?: string, runUrl?: string | null, comment?: string, hours?: number, items?: number } | null
}

export function getChanges() {
  return api<{ changes: Change[] }>('/changes')
}

export function getChange(id: string) {
  return api<{ change: Change, canRetry: boolean, canWithdraw: boolean, others: Change[], events: ChangeEvent[] }>(`/changes/${encodeURIComponent(id)}`)
}

export function retryChange(id: string) {
  return api<{ ok: boolean }>(`/changes/${encodeURIComponent(id)}/retry`, { method: 'POST' })
}

export function withdrawChange(id: string) {
  return api<{ ok: boolean }>(`/changes/${encodeURIComponent(id)}/withdraw`, { method: 'POST' })
}
