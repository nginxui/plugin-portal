import type { Check } from '@/api/submit'
import { api } from '@/api/client'

// Submissions started and not sent yet, kept with the account so they can be
// continued on any device.

export interface SubmitDraft {
  repo: string
  id: string | null
  name: Record<string, string>
  step: number
  at: number
  problem: Check | null
  publicKey?: string
  categories?: string[]
}

export async function loadDrafts(): Promise<SubmitDraft[]> {
  return (await api<{ drafts: SubmitDraft[] }>('/submit/drafts')).drafts
}

export function rememberDraft(draft: Omit<SubmitDraft, 'at'>) {
  return api<{ ok: boolean }>('/submit/drafts', { method: 'PUT', json: draft }).catch(() => null)
}

export function forgetDraft(repo: string) {
  return api<{ ok: boolean }>(`/submit/drafts?repo=${encodeURIComponent(repo)}`, { method: 'DELETE' }).catch(() => null)
}
