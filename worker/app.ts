import type { AppEnv } from './env'
import { Hono } from 'hono'
import { GitHubError } from './lib/github'
import { SessionExpired } from './lib/session'
import { security } from './middleware/security'
import { aiAdmin } from './routes/aiAdmin'
import { audit } from './routes/audit'
import { auth } from './routes/auth'
import { changes } from './routes/changes'
import { community } from './routes/community'
import { hooks } from './routes/hooks'
import { maintain } from './routes/maintain'
import { me } from './routes/me'
import { owners } from './routes/owners'
import { partners } from './routes/partners'
import { plugins } from './routes/plugins'
import { preflight } from './routes/preflight'
import { review } from './routes/review'
import { selfService } from './routes/selfService'
import { media, store } from './routes/store'
import { submit } from './routes/submit'

export const app = new Hono<AppEnv>().basePath('/api')

app.use('*', security)
app.route('/auth', auth)
app.route('/me', me)
app.route('/media', media)
app.route('/', store)
app.route('/', community)
app.route('/', preflight)
app.route('/plugins', selfService)
app.route('/plugins', plugins)
app.route('/', partners)
app.route('/owners', owners)
app.route('/submit', submit)
app.route('/changes', changes)
app.route('/hooks', hooks)
app.route('/review', review)
app.route('/audit', audit)
app.route('/ai/admin', aiAdmin)
app.route('/maintain', maintain)

app.notFound(c => c.json({ error: 'not_found' }, 404))

app.onError((error, c) => {
  if (error instanceof SessionExpired)
    return c.json({ error: 'unauthenticated' }, 401)
  if (error instanceof GitHubError)
    return c.json({ error: 'github', status: error.status }, 502)
  console.error(error)
  return c.json({ error: 'internal' }, 500)
})
