import type { AppEnv } from '../env'
import type { ProviderRow } from '../lib/ai'
import { Hono } from 'hono'
import { AiError, draft, presentProvider, sealKey, today } from '../lib/ai'
import { audit } from '../lib/audit'
import { now } from '../lib/time'
import { requireMaintainer, requireSession } from '../middleware/auth'

// AI providers, for maintainers only (spec 9). A key can be replaced but never
// read back.

export const aiAdmin = new Hono<AppEnv>()

aiAdmin.use('*', requireSession, requireMaintainer)

interface ProviderInput {
  kind?: string
  name?: string
  base_url?: string | null
  model?: string
  key?: string
  daily_quota?: number
  enabled?: boolean
  is_default?: boolean
}

function clean(input: ProviderInput, creating: boolean): { error: string } | Partial<ProviderRow> & { key?: string } {
  const out: Partial<ProviderRow> & { key?: string } = {}
  if (input.kind !== undefined || creating) {
    if (input.kind !== 'anthropic' && input.kind !== 'openai')
      return { error: 'kind' }
    out.kind = input.kind
  }
  if (input.name !== undefined || creating) {
    const name = String(input.name ?? '').trim().slice(0, 60)
    if (!name)
      return { error: 'name' }
    out.name = name
  }
  if (input.model !== undefined || creating) {
    const model = String(input.model ?? '').trim().slice(0, 100)
    if (!model)
      return { error: 'model' }
    out.model = model
  }
  if (input.base_url !== undefined) {
    const url = String(input.base_url ?? '').trim()
    if (url && !/^https:\/\/\S+$/.test(url))
      return { error: 'base_url' }
    out.base_url = url || null
  }
  if (input.key !== undefined || creating) {
    const key = String(input.key ?? '').trim()
    if (!key && creating)
      return { error: 'key' }
    if (key)
      out.key = key
  }
  if (input.daily_quota !== undefined) {
    const quota = Math.floor(Number(input.daily_quota))
    if (!Number.isFinite(quota) || quota < 0 || quota > 10000)
      return { error: 'daily_quota' }
    out.daily_quota = quota
  }
  if (input.enabled !== undefined)
    out.enabled = input.enabled ? 1 : 0
  if (input.is_default !== undefined)
    out.is_default = input.is_default ? 1 : 0
  return out
}

aiAdmin.get('/providers', async (c) => {
  const [providers, usage] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM ai_providers ORDER BY is_default DESC, id').all<ProviderRow>(),
    c.env.DB.prepare('SELECT count(*) AS authors, sum(requests) AS requests, sum(input_tokens) AS input, sum(output_tokens) AS output FROM ai_usage WHERE day = ?').bind(today()).first<{ authors: number, requests: number | null, input: number | null, output: number | null }>(),
  ])
  return c.json({
    keyConfigured: !!c.env.AI_KEY,
    providers: providers.results.map(presentProvider),
    today: { authors: usage?.authors ?? 0, requests: usage?.requests ?? 0, inputTokens: usage?.input ?? 0, outputTokens: usage?.output ?? 0 },
  })
})

aiAdmin.post('/providers', async (c) => {
  const session = c.get('session')
  const input = clean(await c.req.json<ProviderInput>().catch(() => ({})), true)
  if ('error' in input)
    return c.json({ error: 'invalid', field: input.error }, 422)
  if (input.kind === 'openai' && !input.base_url)
    return c.json({ error: 'invalid', field: 'base_url' }, 422)
  const sealed = await sealKey(c.env, input.key!).catch(() => null)
  if (!sealed)
    return c.json({ error: 'no_key' }, 503)
  const first = !await c.env.DB.prepare('SELECT id FROM ai_providers LIMIT 1').first()
  const row = await c.env.DB.prepare(
    `INSERT INTO ai_providers (kind, name, base_url, model, key_enc, is_default, daily_quota, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(input.kind, input.name, input.base_url ?? null, input.model, sealed, first || input.is_default ? 1 : 0, input.daily_quota ?? 50, input.enabled ?? 1, now()).first<{ id: number }>()
  if (input.is_default && !first)
    await c.env.DB.prepare('UPDATE ai_providers SET is_default = 0 WHERE id != ?').bind(row!.id).run()
  await audit(c.env.DB, { actorId: session.user.id, action: 'ai.provider_add', subject: input.name, detail: { kind: input.kind, model: input.model } })
  return c.json({ id: row!.id }, 201)
})

aiAdmin.patch('/providers/:id', async (c) => {
  const session = c.get('session')
  const id = Number(c.req.param('id'))
  const current = await c.env.DB.prepare('SELECT * FROM ai_providers WHERE id = ?').bind(id).first<ProviderRow>()
  if (!current)
    return c.json({ error: 'not_found' }, 404)
  const input = clean(await c.req.json<ProviderInput>().catch(() => ({})), false)
  if ('error' in input)
    return c.json({ error: 'invalid', field: input.error }, 422)
  const sets: string[] = []
  const binds: unknown[] = []
  for (const key of ['kind', 'name', 'base_url', 'model', 'daily_quota', 'enabled', 'is_default'] as const) {
    if (input[key] !== undefined) {
      sets.push(`${key} = ?`)
      binds.push(input[key])
    }
  }
  if (input.key) {
    const sealed = await sealKey(c.env, input.key).catch(() => null)
    if (!sealed)
      return c.json({ error: 'no_key' }, 503)
    sets.push('key_enc = ?')
    binds.push(sealed)
  }
  if (!sets.length)
    return c.json({ ok: true })
  const statements = [c.env.DB.prepare(`UPDATE ai_providers SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id)]
  if (input.is_default)
    statements.push(c.env.DB.prepare('UPDATE ai_providers SET is_default = 0 WHERE id != ?').bind(id))
  await c.env.DB.batch(statements)
  const changed = Object.keys(input).filter(k => k !== 'key')
  await audit(c.env.DB, { actorId: session.user.id, action: 'ai.provider_change', subject: current.name, detail: { changed, keyReplaced: !!input.key, quota: input.daily_quota !== undefined ? { from: current.daily_quota, to: input.daily_quota } : undefined } })
  return c.json({ ok: true })
})

aiAdmin.delete('/providers/:id', async (c) => {
  const session = c.get('session')
  const current = await c.env.DB.prepare('SELECT * FROM ai_providers WHERE id = ?').bind(Number(c.req.param('id'))).first<ProviderRow>()
  if (!current)
    return c.json({ error: 'not_found' }, 404)
  await c.env.DB.prepare('DELETE FROM ai_providers WHERE id = ?').bind(current.id).run()
  await audit(c.env.DB, { actorId: session.user.id, action: 'ai.provider_remove', subject: current.name })
  return c.json({ ok: true })
})

// Drafts one short text with the provider, counted like any draft.
aiAdmin.post('/providers/:id/test', async (c) => {
  const session = c.get('session')
  const provider = await c.env.DB.prepare('SELECT * FROM ai_providers WHERE id = ?').bind(Number(c.req.param('id'))).first<ProviderRow>()
  if (!provider)
    return c.json({ error: 'not_found' }, 404)
  const started = Date.now()
  try {
    const result = await draft(c.env, session.user.id, { source: 'Restrict site access by country.', locale: 'zh_CN', field: 'description', plugin: 'Connection test' }, { ...provider, daily_quota: Number.MAX_SAFE_INTEGER })
    return c.json({ ok: true, text: result.text, ms: Date.now() - started })
  }
  catch (error) {
    return c.json({ ok: false, error: error instanceof AiError ? error.code : 'provider', message: (error as Error).message })
  }
})
