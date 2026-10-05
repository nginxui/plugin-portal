import type { Env } from '../env'
import { open, seal } from './crypto'
import { now } from './time'

// Settings maintainers change on the Settings page, kept in D1. Each falls
// back to the Worker variables it replaces, so a portal set up that way keeps
// working. Secrets are sealed with SESSION_KEY and never read back.

const CONTEXT = 'portal-setting'

export type MailConfig
  = | { kind: 'http', url: string, key: string, from: string }
    | { kind: 'smtp', host: string, port: number, user: string, password: string, from: string }

const MAIL_KEYS = ['mail.kind', 'mail.url', 'mail.key', 'mail.from', 'mail.smtp_host', 'mail.smtp_port', 'mail.smtp_user', 'mail.smtp_password']

export interface BotConfig {
  login: string
  token: string
}

async function values(env: Env, names: string[]): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(`SELECT name, value FROM settings WHERE name IN (${names.map(() => '?').join(', ')})`)
    .bind(...names)
    .all<{ name: string, value: string }>()
  return Object.fromEntries(results.map(r => [r.name, r.value]))
}

async function unseal(env: Env, sealed: string | undefined): Promise<string | null> {
  if (!sealed || !env.SESSION_KEY)
    return null
  try {
    return await open(env.SESSION_KEY, sealed, CONTEXT)
  }
  catch {
    return null
  }
}

/** Writes settings; a null value removes one. Secrets are sealed first. */
export async function saveSettings(env: Env, userId: number, entries: Record<string, string | null>, secrets: string[] = []): Promise<void> {
  const t = now()
  const statements = []
  for (const [name, value] of Object.entries(entries)) {
    if (value === null) {
      statements.push(env.DB.prepare('DELETE FROM settings WHERE name = ?').bind(name))
      continue
    }
    const stored = secrets.includes(name) ? await seal(env.SESSION_KEY, value, CONTEXT) : value
    statements.push(env.DB.prepare(`INSERT INTO settings (name, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(name, stored, userId, t))
  }
  if (statements.length)
    await env.DB.batch(statements)
}

/** The mail service, from the Settings page or else the Worker variables. */
export async function mailConfig(env: Env): Promise<(MailConfig & { source: 'settings' | 'env' }) | null> {
  const v = await values(env, MAIL_KEYS)
  if (v['mail.kind'] === 'smtp') {
    // A server that takes mail without signing in needs no password.
    const password = v['mail.smtp_password'] ? await unseal(env, v['mail.smtp_password']) : ''
    if (v['mail.smtp_host'] && v['mail.from'] && password !== null)
      return { kind: 'smtp', host: v['mail.smtp_host'], port: Number(v['mail.smtp_port'] ?? 587), user: v['mail.smtp_user'] ?? '', password, from: v['mail.from'], source: 'settings' }
  }
  else {
    const key = await unseal(env, v['mail.key'])
    if (v['mail.url'] && key && v['mail.from'])
      return { kind: 'http', url: v['mail.url'], key, from: v['mail.from'], source: 'settings' }
  }
  if (env.EMAIL_API_URL && env.EMAIL_API_KEY && env.EMAIL_FROM)
    return { kind: 'http', url: env.EMAIL_API_URL, key: env.EMAIL_API_KEY, from: env.EMAIL_FROM, source: 'env' }
  if (env.SMTP_HOST && env.EMAIL_FROM)
    return { kind: 'smtp', host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), user: env.SMTP_USER ?? '', password: env.SMTP_PASSWORD ?? '', from: env.EMAIL_FROM, source: 'env' }
  return null
}

/** The bot account, from the Settings page or else the Worker variables. */
export async function botConfig(env: Env): Promise<(BotConfig & { source: 'settings' | 'env' }) | null> {
  const v = await values(env, ['bot.login', 'bot.token'])
  const token = await unseal(env, v['bot.token'])
  if (v['bot.login'] && token)
    return { login: v['bot.login'], token, source: 'settings' }
  if (env.BOT_LOGIN && env.BOT_TOKEN)
    return { login: env.BOT_LOGIN, token: env.BOT_TOKEN, source: 'env' }
  return null
}

/** What the Settings page shows: everything but the secrets. */
export async function settingsView(env: Env) {
  const v = await values(env, [...MAIL_KEYS, 'bot.login', 'bot.token'])
  const [mail, bot] = await Promise.all([mailConfig(env), botConfig(env)])
  return {
    mail: {
      kind: v['mail.kind'] === 'smtp' ? 'smtp' as const : 'http' as const,
      url: v['mail.url'] ?? '',
      from: v['mail.from'] ?? '',
      keySet: !!v['mail.key'],
      host: v['mail.smtp_host'] ?? '',
      port: Number(v['mail.smtp_port'] ?? 587),
      user: v['mail.smtp_user'] ?? '',
      passwordSet: !!v['mail.smtp_password'],
      active: mail?.source ?? null,
      // What the mail in use goes through, the Worker variables included.
      activeKind: mail?.kind ?? null,
    },
    bot: { login: v['bot.login'] ?? '', tokenSet: !!v['bot.token'], active: bot?.source ?? null },
  }
}
