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
}

export function getMe() {
  return api<Me>('/me')
}

export function logout() {
  return api<void>('/auth/logout', { method: 'POST' })
}

export function signInUrl(next: string) {
  return `/api/auth/login?next=${encodeURIComponent(next)}`
}
