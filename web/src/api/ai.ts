import { api } from './client'

export interface Provider {
  id: number
  kind: 'anthropic' | 'openai'
  name: string
  baseUrl: string | null
  model: string
  isDefault: boolean
  dailyQuota: number
  enabled: boolean
  createdAt: number
}

export interface ProviderInput {
  kind?: 'anthropic' | 'openai'
  name?: string
  base_url?: string | null
  model?: string
  key?: string
  daily_quota?: number
  enabled?: boolean
  is_default?: boolean
}

export function getProviders() {
  return api<{ keyConfigured: boolean, providers: Provider[], today: { authors: number, requests: number, inputTokens: number, outputTokens: number }, glossary?: { locales: number, syncedAt: number | null } }>('/ai/admin/providers')
}

export function syncGlossary() {
  return api<{ locales: number, syncedAt: number }>('/ai/admin/glossary/sync', { method: 'POST' })
}

export function addProvider(input: ProviderInput) {
  return api<{ id: number }>('/ai/admin/providers', { method: 'POST', json: input })
}

export function updateProvider(id: number, input: ProviderInput) {
  return api<{ ok: boolean }>(`/ai/admin/providers/${id}`, { method: 'PATCH', json: input })
}

export function removeProvider(id: number) {
  return api<{ ok: boolean }>(`/ai/admin/providers/${id}`, { method: 'DELETE' })
}

export function testProvider(id: number) {
  return api<{ ok: boolean, text?: string, ms?: number, error?: string, message?: string }>(`/ai/admin/providers/${id}/test`, { method: 'POST' })
}
