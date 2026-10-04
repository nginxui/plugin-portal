import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // The workerd bundled with the test pool can lag behind wrangler.
        compatibilityDate: '2026-08-22',
        // Uploads are tested against a local bucket; deployments bind one only once it exists.
        r2Buckets: ['MEDIA'],
        bindings: {
          TEST_MIGRATIONS: migrations,
          PORTAL_ORIGIN: 'https://portal.test',
          GITHUB_CLIENT_ID: 'Iv1.test',
          GITHUB_CLIENT_SECRET: 'secret',
          SESSION_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
})
