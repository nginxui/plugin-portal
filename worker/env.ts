export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PORTAL_ORIGIN: string
  CATALOG_URL: string
  CATALOG_REPO: string
  GITHUB_CLIENT_ID: string
  CATALOG_APP_SLUG: string
  // The catalog workflow that reports deploys, deploy.yml unless set.
  DEPLOY_WORKFLOW?: string
  GITHUB_CLIENT_SECRET: string
  SESSION_KEY: string
  DEPLOY_APP_ID: string
  DEPLOY_APP_PRIVATE_KEY: string
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
