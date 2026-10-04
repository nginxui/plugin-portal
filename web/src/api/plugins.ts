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
  signer: string | null
  yanked: boolean
  yankedBy: 'version' | 'signer' | null
  prerelease: boolean
}

export interface SelfServiceOperations {
  yank?: string[]
  unyank?: string[]
  revoke_signers?: string[]
  categories?: string[]
}

export interface PluginDetail {
  plugin: PluginSummary
  releases: Release[]
  revokedSigners: string[]
  // The newest self service change still in progress, or merged and not live.
  pending: { id: string, kind: string } | null
  openChanges: OpenChange[]
  store: { source: 'repo' | 'catalog', follow?: 'branch' | 'release' } | null
  listed: boolean
  access: {
    role: Role | null
    permission: 'admin' | 'maintain' | 'write' | 'triage' | 'other' | null
    checkedAt: number | null
    source: 'repository'
    manageUrl: string | null
  }
}

export interface OpenChange {
  id: string
  kind: string
  class: string
  stage: string
  waitingOn: string | null
  prNumber: number | null
  createdAt: number
  updatedAt: number
}

export type StoreSource = 'release' | 'repo-branch' | 'repo-release' | 'catalog'

export interface Insights {
  id: string
  downloads: { version: string, count: number }[]
  platforms: number | null
  translated: string[]
  untranslated: string[]
  screenshots: { total: number, dark: number }
  readme: boolean
  storeSource: StoreSource
  minHostVersion: string | null
  openIssues: number | null
  releases: { version: string, publishedAt: string | null, yanked: boolean, prerelease: boolean }[]
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

export function getInsights() {
  return api<{ insights: Insights[] }>('/plugins/insights')
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

export function submitSelfService(id: string, operations: SelfServiceOperations, reason = '') {
  return api<{ change: string }>(`/plugins/${encodeURIComponent(id)}/changes`, { method: 'POST', json: { operations, reason } })
}
