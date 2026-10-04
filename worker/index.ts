import type { Env } from './env'
import { app } from './app'
import { scheduled } from './jobs'

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(scheduled(env))
  },
} satisfies ExportedHandler<Env>
