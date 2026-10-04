import type { Role } from './plugins'
import { api } from './client'

export interface OrgPage {
  owner: { login: string, name: string | null, avatarUrl: string | null, kind: 'organization' | 'user', url: string }
  plugins: { id: string, name: Record<string, string>, iconUrl: string | null, state: string, version: string | null, repo: string | null, role: Role | null, trust: string | null }[]
  canApply: boolean
  partner: { name: string, displayName: string, keyId: string | null, expires: string | null, revoked: boolean } | null
  application: { id: string, state: string, reason: string | null, createdAt: number } | null
  accessUrl: string | null
}

export function getOrg(login: string) {
  return api<OrgPage>(`/owners/${encodeURIComponent(login)}`)
}

export function applyPartner(login: string, input: { name: string, display_name: string, homepage_url?: string, description?: string, logo_url?: string, public_key: string, note?: string }) {
  return api<{ id: string }>(`/owners/${encodeURIComponent(login)}/partner-application`, { method: 'POST', json: input })
}

export interface VendorSummary {
  id: number
  slug: string | null
  name: string | null
  partner: string | null
  role: Role
}

export function getVendors() {
  return api<{ vendors: VendorSummary[] }>('/vendors')
}

export interface VendorPage {
  vendor: { id: number, slug: string | null, name: string | null, partner: string | null }
  role: Role | null
  isMaintainer: boolean
  canManage: boolean
  members: { userId: number, login: string | null, avatarUrl: string | null, role: Role, addedAt: number, addedBy: string | null }[]
  plugins: {
    id: string
    name: Record<string, string>
    state: string
    version: string | null
    releasesUrl: string | null
    commercial: { pricing: Record<string, string>, purchase_url: string, trial_days?: number, license?: string } | null
    feed: { ok: boolean, latest: string | null, releases: number, error?: string } | null
    listedVersions: string[]
  }[]
  partner: { name: string, keyId: string | null, expires: string | null, revoked: boolean } | null
  requests: { id: string, kind: string, state: string, reason: string | null, createdAt: number }[]
}

export function getVendor(id: number) {
  return api<VendorPage>(`/vendors/${id}`)
}

export function addMember(id: number, login: string, role: Role) {
  return api<{ ok: boolean }>(`/vendors/${id}/members`, { method: 'POST', json: { login, role } })
}

export function setMemberRole(id: number, userId: number, role: Role) {
  return api<{ ok: boolean }>(`/vendors/${id}/members/${userId}`, { method: 'PATCH', json: { role } })
}

export function removeMember(id: number, userId: number) {
  return api<{ ok: boolean }>(`/vendors/${id}/members/${userId}`, { method: 'DELETE' })
}

export function addVendorPlugin(id: number, input: { id: string, name: Record<string, string>, releases_url: string, categories: string[], license?: string }) {
  return api<{ change: string }>(`/vendors/${id}/plugins`, { method: 'POST', json: input })
}

export function setCommercial(id: number, pluginId: string, input: { pricing: Record<string, string>, purchase_url: string, trial_days?: number, license?: string }) {
  return api<{ change: string }>(`/vendors/${id}/plugins/${encodeURIComponent(pluginId)}/commercial`, { method: 'PUT', json: input })
}

export function keyRequest(id: number, input: { kind: 'rotation' | 'revocation', public_key?: string, reason: string }) {
  return api<{ id: string }>(`/vendors/${id}/key-request`, { method: 'POST', json: input })
}
