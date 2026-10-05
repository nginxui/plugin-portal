import { api } from './client'

export interface User {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface Me {
  user: User | null
  isMaintainer: boolean
  // The interface language kept with the account, for mail.
  locale?: string | null
}

export function getMe() {
  return api<Me>('/me')
}

export function saveLocale(locale: string) {
  return api<{ ok: boolean }>('/me/locale', { method: 'PUT', json: { locale } })
}

export function logout() {
  return api<void>('/auth/logout', { method: 'POST' })
}

export function signInUrl(next: string) {
  return `/api/auth/login?next=${encodeURIComponent(next)}`
}
