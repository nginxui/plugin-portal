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
  // The machine user that forks plugin repositories and opens pull requests
  // for store changes (spec 7.2). Without a token authors get a patch.
  BOT_LOGIN?: string
  BOT_TOKEN?: string
  // Screenshot uploads and the mirror (spec 7.3). Without a bucket uploads
  // are off and screenshots stay in repositories.
  MEDIA?: R2Bucket
  MEDIA_URL?: string
  // Key for AI provider keys at rest, apart from the session key.
  AI_KEY?: string
  // Mail for the tracker; off until all three are set.
  EMAIL_API_URL?: string
  EMAIL_API_KEY?: string
  EMAIL_FROM?: string
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
