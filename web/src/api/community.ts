import { api } from './client'

export interface Suggestion {
  id: number
  field: string
  locale: string
  text: string
  author: string | null
  avatarUrl: string | null
  createdAt: number
}

export interface CommunityState {
  enabled: boolean
  locales: string[] | null
  translationsPr: number | null
  canManage: boolean
  canReview: boolean
  pending: Suggestion[]
  rolling: { change: string, prNumber: number | null, prUrl: string | null, strings: number, batches: number } | null
}

export function aiStatus() {
  return api<{ enabled: boolean, provider?: string, remaining?: number }>('/ai/status')
}

export function aiDraft(pluginId: string, field: string, locale: string, source: string) {
  return api<{ text: string, remaining: number }>('/ai/draft', { method: 'POST', json: { plugin_id: pluginId, field, locale, source } })
}

export function getGlossary(locale: string) {
  return api<{ terms: Record<string, string> }>(`/glossary/${encodeURIComponent(locale)}`)
}

export function getCommunity(id: string) {
  return api<CommunityState>(`/plugins/${encodeURIComponent(id)}/community`)
}

export function setCommunity(id: string, enabled: boolean, locales: string[] | null) {
  return api<{ ok: boolean }>(`/plugins/${encodeURIComponent(id)}/community`, { method: 'PATCH', json: { enabled, locales } })
}

export function suggest(id: string, field: string, locale: string, text: string) {
  return api<{ ok: boolean }>(`/plugins/${encodeURIComponent(id)}/suggestions`, { method: 'POST', json: { field, locale, text } })
}

export function decide(id: string, accept: { id: number, text?: string }[], decline: { id: number, reason?: string }[]) {
  return api<{ ok: boolean, change: string | null, delivery: string | null }>(`/plugins/${encodeURIComponent(id)}/suggestions/decide`, { method: 'POST', json: { accept, decline } })
}

export interface TranslatorOverview {
  langs: string[]
  counts: Record<string, number>
  suggestions: { id: number, pluginId: string, field: string, locale: string, text: string, state: string, reason: string | null, decidedAt: number | null, createdAt: number, change: string | null, changeState: string | null, changeStage: string | null }[]
  decisions: { pluginId: string, name: Record<string, string>, state: 'accepted' | 'declined', count: number, decider: string | null, reason: string | null, at: number }[]
  progress: { pluginId: string, name: Record<string, string>, iconUrl: string | null, count: number, state: 'pending' | 'accepted' | 'merged' | 'live', prNumber: number | null }[]
  open: { pluginId: string, name: Record<string, string>, owner: string | null, iconUrl: string | null, locales: string[] | null, missing: number, updatedAt: number, installs: number, reviewHours: number | null }[]
}

export function getTranslator() {
  return api<TranslatorOverview>('/translate')
}

export function setTranslatorLangs(locales: string[]) {
  return api<{ ok: boolean, locales: string[] }>('/translate/langs', { method: 'PUT', json: { locales } })
}

export interface TranslatePlugin {
  pluginId: string
  name: Record<string, string>
  locales: string[] | null
  nameLocked: boolean
  rows: { field: string, en: string, all: Record<string, string> }[]
  mine: { field: string, locale: string, text: string }[]
}

export function getTranslatePlugin(id: string) {
  return api<TranslatePlugin>(`/translate/plugins/${encodeURIComponent(id)}`)
}
