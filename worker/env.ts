export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PORTAL_ORIGIN: string
  CATALOG_URL: string
  CATALOG_REPO: string
  GITHUB_CLIENT_ID: string
  CATALOG_APP_SLUG: string
  GITHUB_CLIENT_SECRET: string
  SESSION_KEY: string
}

export interface SessionUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface Session {
  id: string
  user: SessionUser
  isMaintainer: boolean
  maintainerCheckedAt: number
}

export interface AppEnv {
  Bindings: Env
  Variables: {
    session: Session
  }
}
