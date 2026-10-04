import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach } from 'vitest'

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

// Storage is shared by every test of a file, so start each from empty tables.
beforeEach(async () => {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'`,
  ).all<{ name: string }>()
  await env.DB.batch(results.map(({ name }) => env.DB.prepare(`DELETE FROM "${name}"`)))
})
