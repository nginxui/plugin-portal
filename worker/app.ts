import type { AppEnv } from './env'
import { Hono } from 'hono'
import { GitHubError } from './lib/github'
import { SessionExpired } from './lib/session'
import { security } from './middleware/security'
import { auth } from './routes/auth'
import { changes } from './routes/changes'
import { hooks } from './routes/hooks'
import { me } from './routes/me'
import { owners } from './routes/owners'
import { plugins } from './routes/plugins'
import { review } from './routes/review'
import { selfService } from './routes/selfService'
import { submit } from './routes/submit'

export const app = new Hono<AppEnv>().basePath('/api')

app.use('*', security)
app.route('/auth', auth)
app.route('/me', me)
app.route('/plugins', selfService)
app.route('/plugins', plugins)
app.route('/owners', owners)
app.route('/submit', submit)
app.route('/changes', changes)
app.route('/hooks', hooks)
app.route('/review', review)

app.notFound(c => c.json({ error: 'not_found' }, 404))

app.onError((error, c) => {
  if (error instanceof SessionExpired)
    return c.json({ error: 'unauthenticated' }, 401)
  if (error instanceof GitHubError)
    return c.json({ error: 'github', status: error.status }, 502)
  console.error(error)
  return c.json({ error: 'internal' }, 500)
})
