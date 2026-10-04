import { api } from './client'

export interface AdminPlugin {
  id: string
  name: Record<string, string>
  iconUrl: string | null
  owner: string | null
  ownerKind: 'github' | 'vendor'
  repo: string | null
  trust: string | null
  version: string | null
  source: string
  state: 'listed' | 'review' | 'yanked' | 'delisted'
  openChanges: number
}

export interface AdminPlugins {
  plugins: AdminPlugin[]
  counts: { listed: number, byTrust: Record<string, number>, newThisWeek: number, reviewHours: number | null, yanked: number, blocked: number }
  blocked: { kind: 'plugin' | 'repository', value: string, reason?: string, added_by?: string, added_at?: string }[]
  blockedUrl: string
}

export function getAllPlugins() {
  return api<AdminPlugins>('/maintain/plugins')
}

export function setTrust(id: string, trust: string, reason: string) {
  return api<{ change: string }>(`/maintain/plugins/${encodeURIComponent(id)}/trust`, { method: 'POST', json: { trust, reason } })
}

export function delist(id: string, reason: string, block: boolean, repository: string | null) {
  return api<{ change: string }>(`/maintain/plugins/${encodeURIComponent(id)}/delist`, { method: 'POST', json: { reason, block, repository } })
}

export function addBlock(input: { plugin_id?: string, repository?: string, reason: string }) {
  return api<{ change: string }>('/maintain/blocklist', { method: 'POST', json: input })
}

export interface PartnerRequest {
  id: string
  kind: 'application' | 'profile' | 'key_rotation' | 'key_revocation'
  owner: string | null
  vendorId: number | null
  partner: string
  by: string | null
  createdAt: number
  profile: Record<string, string> | null
  keyId: string | null
  reason: string | null
  note: string | null
  checks: { listedPlugins: number, hasKey: boolean, createdYear?: number | null } | null
}

export interface PartnersAdmin {
  requests: PartnerRequest[]
  partners: { name: string, displayName: string, kind: string, owner: string | null, plugins: number, keyId: string | null, expires: string | null, state: 'valid' | 'expiring' | 'expired' | 'revoked' }[]
  vendors: { id: number, slug: string | null, name: string | null, partner: string | null, plugins: number }[]
}

export function getPartnersAdmin() {
  return api<PartnersAdmin>('/maintain/partners')
}

export function approveRequest(id: string) {
  return api<{ change: string }>(`/maintain/partner-requests/${id}/approve`, { method: 'POST' })
}

export function declineRequest(id: string, reason: string) {
  return api<{ ok: boolean }>(`/maintain/partner-requests/${id}/decline`, { method: 'POST', json: { reason } })
}

export function revokePartner(name: string, reason: string) {
  return api<{ change: string }>(`/maintain/partners/${encodeURIComponent(name)}/revoke`, { method: 'POST', json: { reason } })
}

export function createVendor(input: { slug: string, name: string, partner?: string, admins: string[] }) {
  return api<{ id: number, admins: string[] }>('/maintain/vendors', { method: 'POST', json: input })
}
