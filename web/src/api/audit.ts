import { api } from './client'

export type AuditKind = 'review' | 'self_service' | 'submission' | 'maintainer' | 'ai' | 'settings' | 'system' | 'account'

export interface AuditEntry {
  id: number
  at: number
  actor: string | null
  actorAvatar: string | null
  kind: AuditKind
  action: string
  subject: string | null
  detail: Record<string, any> | null
  record: { label: string, url: string } | null
}

export interface AuditQuery {
  kind?: AuditKind
  actor?: string
  subject?: string
  days?: number
}

export function auditParams(query: AuditQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== 0)
      params.set(key, String(value))
  }
  return params.toString()
}

export function getAudit(query: AuditQuery, before?: number) {
  return api<{ entries: AuditEntry[], total: number, next: number | null }>(`/audit?${auditParams(query, before ? { before: String(before) } : {})}`)
}

export function auditExportUrl(query: AuditQuery, format: 'csv' | 'json'): string {
  return `/api/audit?${auditParams(query, { format })}`
}
