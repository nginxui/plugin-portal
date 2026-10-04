import type { PreviewDoc, PreviewManifest } from '@/components/MarketPreview.vue'
import { api } from './client'

export type StoreSourceKind = 'release' | 'repo-branch' | 'repo-release' | 'catalog'

export interface StoreItem {
  field: string
  locale?: string
  label: string
  review: boolean
}

export interface StoreDraft {
  doc: PreviewDoc
  readme?: string | null
  source?: Exclude<StoreSourceKind, 'release'>
  ai?: string[]
  // Translations of the runtime strings of plugin.json, by locale and permission.
  runtime?: Record<string, Record<string, string>>
  updatedAt: number
}

export interface StoreState {
  source: StoreSourceKind
  repo: string | null
  ref: string | null
  tag: string | null
  version: string | null
  doc: PreviewDoc
  readme: string | null
  manifest: (PreviewManifest & Record<string, unknown>) | null
  overrides: Record<string, unknown>
  images: Record<string, string | null>
  draft: StoreDraft | null
  items: StoreItem[]
  pending: string | null
  canEdit: { texts: boolean, all: boolean }
  delivery: { bot: boolean, patch: boolean }
  uploads: boolean
}

export function getStore(id: string) {
  return api<StoreState>(`/plugins/${encodeURIComponent(id)}/store`)
}

export function saveDraft(id: string, draft: { doc: PreviewDoc, readme?: string | null, source?: string, ai?: string[], runtime?: Record<string, Record<string, string>> }) {
  return api<{ ok: boolean, problems: string[] }>(`/plugins/${encodeURIComponent(id)}/store/draft`, { method: 'PUT', json: draft })
}

export function discardDraft(id: string) {
  return api<{ ok: boolean }>(`/plugins/${encodeURIComponent(id)}/store/draft`, { method: 'DELETE' })
}

export function submitStore(id: string, delivery: 'bot' | 'patch') {
  return api<{ change: string, moveChange: string | null, delivery: string, prUrl: string | null }>(`/plugins/${encodeURIComponent(id)}/store/submit`, { method: 'POST', json: { delivery } })
}

export async function uploadImage(blob: Blob) {
  const response = await fetch('/api/media', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/webp', 'X-Portal-Request': '1' }, credentials: 'same-origin' })
  const data = await response.json().catch(() => ({})) as { path?: string, url?: string, error?: string, width?: number, height?: number }
  if (!response.ok)
    throw new Error(data.error ?? 'upload_failed')
  return data as { path: string, url: string, width: number, height: number }
}
