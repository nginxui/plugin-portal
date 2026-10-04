import { api } from './client'

export type CheckStatus = 'pass' | 'fail' | 'warn'

export interface Check {
  key: string
  status: CheckStatus
  reason?: string
  params?: Record<string, string>
}

export interface Draft {
  repo: string
  id: string
  name: Record<string, string>
  description: string
  version: string
  tag: string
  prerelease: boolean
  releaseUrl: string
  packages: string[]
  license: string | null
  categories: string[]
  readmeUrl: string
}

export interface Preview {
  checks: Check[]
  draft: Draft | null
  ok: boolean
}

export function getCategories() {
  return api<{ categories: string[] }>('/submit/categories')
}

export function checkRepository(repo: string) {
  return api<Preview>('/submit/check', { method: 'POST', json: { repo } })
}

export function submitPlugin(input: { repo: string, authorPublicKey: string, categories: string[] }) {
  return api<{ change: string }>('/submit', { method: 'POST', json: input })
}
