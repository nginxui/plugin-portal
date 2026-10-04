import { api } from './client'

export type Localized = Record<string, string>
export type Role = 'admin' | 'publisher' | 'translator'

export interface Owner {
  id: number
  login: string
  kind: 'user' | 'organization'
  avatarUrl: string | null
}

export interface PluginSummary {
  id: string
  name: Localized
  description: Localized | null
  iconUrl: string | null
  repo: string | null
  owner: Owner | null
  trust: string | null
  categories: string[]
  version: string | null
  releasedAt: string | null
  state: 'listed' | 'draft' | 'delisted'
  role: Role | null
  catalogUrl: string | null
}

export interface Installable {
  repo: string
  description: string | null
  source: 'installation' | 'admin'
  at: number | null
}

export interface Release {
  version: string
  releasedAt: string | null
  minNginxUiVersion: string | null
  notesUrl: string | null
}

export interface PluginDetail {
  plugin: PluginSummary
  releases: Release[]
  access: {
    role: Role | null
    permission: 'admin' | 'maintain' | 'write' | 'triage' | 'other' | null
    checkedAt: number | null
    source: 'repository'
    manageUrl: string | null
  }
}

export interface OwnerSummary {
  login: string
  kind: 'user' | 'organization'
  avatarUrl: string | null
  plugins: number
  role: Role | null
}

export interface OwnerDetail {
  owner: Owner
  isAdmin: boolean
  plugins: PluginSummary[]
  accessUrl: string | null
}

export function getMyPlugins() {
  return api<{ plugins: PluginSummary[], installable: Installable[], installUrl: string }>('/plugins/mine')
}

export function getPlugin(id: string) {
  return api<PluginDetail>(`/plugins/${encodeURIComponent(id)}`)
}

export function getOwners() {
  return api<{ owners: OwnerSummary[] }>('/owners')
}

export function getOwner(login: string) {
  return api<OwnerDetail>(`/owners/${encodeURIComponent(login)}`)
}
