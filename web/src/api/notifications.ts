import { api } from './client'

export interface NotificationItem {
  id: number
  stage: string
  at: number
  change: string
  number?: number | null
  iconUrl?: string | null
  kind: string
  class?: string
  changeState?: string
  waitingOn?: string | null
  pluginId: string | null
  name: Record<string, string> | null
  actor: string | null
  detail: Record<string, any> | null
  unread: boolean
}

export function getNotifications() {
  return api<{ items: NotificationItem[], unread: number, inApp?: boolean }>('/notifications')
}

export function markRead() {
  return api<{ ok: boolean }>('/notifications/read', { method: 'POST' })
}

export function clearNotifications() {
  return api<{ ok: boolean }>('/notifications/clear', { method: 'POST' })
}

export interface Prefs {
  inApp: boolean
  emailOnAction: boolean
  emailOnLive: boolean
  email: string | null
  mail: boolean
  // Addresses verified on the GitHub account, primary first; null while the
  // portal may not read them.
  emails?: { email: string, primary: boolean }[] | null
}

export function getPrefs() {
  return api<Prefs>('/notifications/prefs')
}

export function savePrefs(prefs: Omit<Prefs, 'mail' | 'emails'> & { mail?: boolean }) {
  return api<{ ok: boolean }>('/notifications/prefs', { method: 'PUT', json: { inApp: prefs.inApp, emailOnAction: prefs.emailOnAction, emailOnLive: prefs.emailOnLive, email: prefs.email } })
}
