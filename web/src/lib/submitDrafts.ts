import type { Check } from '@/api/submit'

// Submissions started and not sent yet, kept in this browser so My plugins
// can offer to continue them. Only a convenience: nothing here is shared.

export interface SubmitDraft {
  repo: string
  id: string | null
  name: Record<string, string>
  step: number
  at: number
  problem: Check | null
}

const KEY = 'portal-submit-drafts'

export function loadDrafts(): SubmitDraft[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SubmitDraft[]
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function save(drafts: SubmitDraft[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts.slice(0, 5)))
  }
  catch {}
}

export function rememberDraft(draft: SubmitDraft) {
  save([draft, ...loadDrafts().filter(d => d.repo.toLowerCase() !== draft.repo.toLowerCase())])
}

export function forgetDraft(repo: string) {
  save(loadDrafts().filter(d => d.repo.toLowerCase() !== repo.toLowerCase()))
}
