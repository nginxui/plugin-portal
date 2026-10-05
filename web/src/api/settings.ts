import { api } from './client'

export interface Announcement {
  id: number
  date: string
  title: Record<string, string>
  text: Record<string, string>
}

export interface PortalSettings {
  mail: MailView
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

export interface MailView {
  kind: 'http' | 'smtp'
  url: string
  from: string
  keySet: boolean
  host: string
  port: number
  user: string
  passwordSet: boolean
  active: 'settings' | 'env' | null
  activeKind: 'http' | 'smtp' | null
}

export interface MailInput {
  kind: 'http' | 'smtp'
  from: string
  url: string
  key: string
  host: string
  port: number
  user: string
  password: string
}

export function saveMail(input: MailInput) {
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
