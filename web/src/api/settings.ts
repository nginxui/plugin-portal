import { api } from './client'

export interface Announcement {
  id: number
  date: string
  title: Record<string, string>
  text: Record<string, string>
}

export interface PortalSettings {
  mail: { url: string, from: string, keySet: boolean, active: 'settings' | 'env' | null }
  bot: { login: string, tokenSet: boolean, active: 'settings' | 'env' | null }
  announcements: Announcement[]
}

export type AnnouncementInput = Omit<Announcement, 'id'>

export function getAnnouncements() {
  return api<{ announcements: Announcement[] }>('/announcements')
}

export function getSettings() {
  return api<PortalSettings>('/settings')
}

export function createAnnouncement(input: AnnouncementInput) {
  return api<{ id: number }>('/settings/announcements', { method: 'POST', json: input })
}

export function updateAnnouncement(id: number, input: AnnouncementInput) {
  return api<{ ok: true }>(`/settings/announcements/${id}`, { method: 'PUT', json: input })
}

export function deleteAnnouncement(id: number) {
  return api<{ ok: true }>(`/settings/announcements/${id}`, { method: 'DELETE' })
}

export function saveMail(input: { url: string, from: string, key: string }) {
  return api<Omit<PortalSettings, 'announcements'>>('/settings/mail', { method: 'PUT', json: input })
}

export function clearMail() {
  return api<Omit<PortalSettings, 'announcements'>>('/settings/mail', { method: 'DELETE' })
}

export function testMail(to: string) {
  return api<{ ok: true }>('/settings/mail/test', { method: 'POST', json: { to } })
}

export function saveBot(input: { login: string, token: string }) {
  return api<Omit<PortalSettings, 'announcements'>>('/settings/bot', { method: 'PUT', json: input })
}

export function clearBot() {
  return api<Omit<PortalSettings, 'announcements'>>('/settings/bot', { method: 'DELETE' })
}
