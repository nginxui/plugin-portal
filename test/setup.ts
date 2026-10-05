import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach } from 'vitest'

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

// Storage is shared by every test of a file, so start each from empty tables.
beforeEach(async () => {
  // Tests send many calls a minute as one user; limits.test.ts stubs these.
  Object.assign(env, { LIMIT_CHECK: undefined, LIMIT_WRITE: undefined, LIMIT_UPLOAD: undefined })
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'`,
  ).all<{ name: string }>()
  // Tables that reference others go first.
  const first = ['vendor_members', 'change_events', 'sessions', 'plugins']
  const names = results.map(r => r.name).sort((a, b) => Number(first.includes(b)) - Number(first.includes(a)))
  await env.DB.batch(names.map(name => env.DB.prepare(`DELETE FROM "${name}"`)))
})
