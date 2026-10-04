declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    ASSETS: Fetcher
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
    PORTAL_ORIGIN: string
    CATALOG_URL: string
    CATALOG_REPO: string
    GITHUB_CLIENT_ID: string
    CATALOG_APP_SLUG: string
    DEPLOY_WORKFLOW?: string
    GITHUB_CLIENT_SECRET: string
    SESSION_KEY: string
    DEPLOY_APP_ID: string
    DEPLOY_APP_PRIVATE_KEY: string
  }
}
