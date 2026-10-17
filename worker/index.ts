import type { Env } from './env'
import { app } from './app'
import { scheduled } from './jobs'
import { refreshHostLocales } from './lib/locales'

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshHostLocales(env).then(() => scheduled(env)))
  },
} satisfies ExportedHandler<Env>
