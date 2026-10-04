import type { Change, ChangeEvent } from './changes'
import { api } from './client'

export interface QueueItem extends Change {
  author: string | null
  repo: string | null
  risk: 'high' | 'normal'
}

export interface ReviewDetail {
  change: Change & { risk: 'high' | 'normal' }
  author: { login: string, avatarUrl: string | null, changes: number, merged: number, plugins?: { id: string, name: string }[], firstListed?: string | null } | null
  rotation?: { oldId: string | null, newId: string | null, versions: string[], seenIn: string[] } | null
  claim: string | null
  repository: string | null
  repositoryCreatedAt?: string | null
  before: Record<string, unknown> | null
  listing: { description: Record<string, string> | null, screenshots: { url: string, dark_url?: string, caption?: Record<string, string> }[], iconUrl: string | null, capabilities: string[], manifest: Record<string, any> | null, version: string | null } | null
  pull: { number: number, state: string, merged: boolean, mergeable: boolean | null, mergeableState: string, url: string, title: string } | null
  checks: { name: string, status: string, conclusion: string | null, url: string }[]
  conversation: { kind: 'review' | 'comment', state: string | null, author: string | null, role: 'maintainer' | null, body: string, at: string }[]
  events: ChangeEvent[]
}

export interface RecentChange extends Change {
  author: string | null
}

export function getQueue() {
  return api<{ changes: QueueItem[], recent: RecentChange[], done?: QueueItem[] }>('/review/queue')
}

export function approveBatch(ids: string[]) {
  return api<{ results: Record<string, string> }>('/review/approve-batch', { method: 'POST', json: { ids } })
}

export function rejectChange(id: string, comment: string) {
  return api<{ ok: boolean }>(`/review/${encodeURIComponent(id)}/reject`, { method: 'POST', json: { comment } })
}

export interface AiFinding {
  severity: 'warn' | 'info' | 'ok'
  text: string
  sources: { label: string, url?: string }[]
}

export interface AiReview {
  findings: AiFinding[]
  provider: string
  model: string
  createdAt: number
}

export function getAiReview(id: string, locale: string) {
  return api<{ enabled: boolean, review: AiReview | null }>(`/review/${encodeURIComponent(id)}/ai?locale=${encodeURIComponent(locale)}`)
}

export function makeAiReview(id: string, locale: string) {
  return api<{ review: AiReview, remaining: number }>(`/review/${encodeURIComponent(id)}/ai`, { method: 'POST', json: { locale } })
}

export function getReview(id: string) {
  return api<ReviewDetail>(`/review/${encodeURIComponent(id)}`)
}

export function approveChange(id: string, comment = '', keepNames: string[] = []) {
  return api<{ ok: boolean, commit: string }>(`/review/${encodeURIComponent(id)}/approve`, { method: 'POST', json: { comment, keepNames } })
}

export function requestChanges(id: string, comment: string) {
  return api<{ ok: boolean }>(`/review/${encodeURIComponent(id)}/request-changes`, { method: 'POST', json: { comment } })
}

export function commentOnChange(id: string, comment: string) {
  return api<{ ok: boolean }>(`/review/${encodeURIComponent(id)}/comment`, { method: 'POST', json: { comment } })
}

export interface CatalogItem {
  id: string
  name: Record<string, string> | null
  owner: string | null
  state: string
  yanked: boolean
}

export function getCatalog() {
  return api<{ plugins: CatalogItem[] }>('/review/catalog')
}
