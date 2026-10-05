import { api } from './client'

export interface NotificationItem {
  id: number
  stage: string
  at: number
  change: string
  number?: number | null
  iconUrl?: string | null
  kind: string
  pluginId: string | null
  name: Record<string, string> | null
  actor: string | null
  detail: Record<string, any> | null
  unread: boolean
}

export function getNotifications() {
  return api<{ items: NotificationItem[], unread: number }>('/notifications')
}

export function markRead() {
  return api<{ ok: boolean }>('/notifications/read', { method: 'POST' })
}

export interface Prefs {
  inApp: boolean
  emailOnAction: boolean
  emailOnLive: boolean
  email: string | null
  mail: boolean
}

export function getPrefs() {
  return api<Prefs>('/notifications/prefs')
}

export function savePrefs(prefs: Omit<Prefs, 'mail'> & { mail?: boolean }) {
  return api<{ ok: boolean }>('/notifications/prefs', { method: 'PUT', json: { inApp: prefs.inApp, emailOnAction: prefs.emailOnAction, emailOnLive: prefs.emailOnLive, email: prefs.email } })
}
