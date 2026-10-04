import type { Change, ChangeEvent } from './changes'
import { api } from './client'

export interface QueueItem extends Change {
  author: string | null
  repo: string | null
  risk: 'high' | 'normal'
}

export interface ReviewDetail {
  change: Change & { risk: 'high' | 'normal' }
  author: { login: string, avatarUrl: string | null, changes: number, merged: number } | null
  claim: string | null
  repository: string | null
  before: Record<string, unknown> | null
  listing: { description: Record<string, string> | null, screenshots: { url: string, dark_url?: string, caption?: Record<string, string> }[], iconUrl: string | null, capabilities: string[], manifest: Record<string, any> | null, version: string | null } | null
  pull: { number: number, state: string, merged: boolean, mergeable: boolean | null, mergeableState: string, url: string, title: string } | null
  checks: { name: string, status: string, conclusion: string | null, url: string }[]
  conversation: { kind: 'review' | 'comment', state: string | null, author: string | null, body: string, at: string }[]
  events: ChangeEvent[]
}

export interface RecentChange extends Change {
  author: string | null
}

export function getQueue() {
  return api<{ changes: QueueItem[], recent: RecentChange[] }>('/review/queue')
}

export function approveBatch(ids: string[]) {
  return api<{ results: Record<string, string> }>('/review/approve-batch', { method: 'POST', json: { ids } })
}

export function rejectChange(id: string, comment: string) {
  return api<{ ok: boolean }>(`/review/${encodeURIComponent(id)}/reject`, { method: 'POST', json: { comment } })
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
