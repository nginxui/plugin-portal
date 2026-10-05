import type { Env } from './env'
import { loadCatalog } from './lib/catalog'
import { event } from './lib/changes'
import { snapshotDownloads } from './lib/downloads'
import { syncGlossary } from './lib/glossary'
import { sendMail } from './lib/mail'
import { buildMail, nameIn } from './lib/mailText'
import { now } from './lib/time'

// Work on a schedule: reminders for changes that wait on their author, and
// email for the stages users asked to hear about.

const REMIND_AFTER = 18 * 3600

// Steps after which the change waits for its author. Checks that found
// problems count; checks that could not run wait for a maintainer instead.
function needsAuthor(stage: string, detail: { outcome?: string } | null): boolean {
  if (stage === 'checks')
    return detail?.outcome === 'checks_failed' || detail?.outcome === 'rejected'
  return stage === 'changes_requested' || stage === 'reminder' || stage === 'rejected'
}

async function state(env: Env, name: string): Promise<string | null> {
  return (await env.DB.prepare('SELECT value FROM job_state WHERE name = ?').bind(name).first<{ value: string }>())?.value ?? null
}

async function setState(env: Env, name: string, value: string) {
  await env.DB.prepare('INSERT INTO job_state (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').bind(name, value).run()
}

/** A reminder for every change that waited on its author 18 hours, once. */
export async function remind(env: Env): Promise<number> {
  const t = now()
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.pr_number FROM changes c WHERE c.state = 'open' AND c.waiting_on = 'author' AND c.updated_at < ?
     AND NOT EXISTS (SELECT 1 FROM change_events e WHERE e.change_id = c.id AND e.stage = 'reminder' AND e.at > c.updated_at)`,
  ).bind(t - REMIND_AFTER).all<{ id: string, pr_number: number | null }>()
  if (results.length)
    await env.DB.batch(results.map(r => event(env, r.id, 'reminder', null, { hours: 18, prNumber: r.pr_number })))
  return results.length
}

/** Mail for new events of users who asked for it. */
export async function mail(env: Env): Promise<number> {
  const last = Number(await state(env, 'mail.event') ?? 0)
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.stage, e.detail_json, e.change_id, c.number, c.kind, c.plugin_id, c.entry_json, u.locale, p.email, p.email_on_action, p.email_on_live
     FROM change_events e JOIN changes c ON c.id = e.change_id JOIN notify_prefs p ON p.user_id = c.author_id LEFT JOIN users u ON u.id = c.author_id
     WHERE e.id > ? AND p.email IS NOT NULL ORDER BY e.id LIMIT 200`,
  ).bind(last).all<{ id: number, stage: string, detail_json: string | null, change_id: string, number: number | null, entry_json: string | null, locale: string | null, kind: string, plugin_id: string | null, email: string, email_on_action: number, email_on_live: number }>()
  let sent = 0
  // Names of listed plugins, for changes that carry no entry of their own.
  let catalog: Map<string, Record<string, string>> | null = null
  const catalogName = async (id: string) => {
    catalog ??= new Map(((await loadCatalog(env).catch(() => null))?.plugins ?? []).map(p => [p.id, p.name as Record<string, string>]))
    return catalog.get(id)
  }
  for (const row of results) {
    const detail = row.detail_json ? JSON.parse(row.detail_json) as { outcome?: string, comment?: unknown } : null
    const action = row.email_on_action && needsAuthor(row.stage, detail)
    const live = row.email_on_live && row.stage === 'live'
    if (action || live) {
      const entry = row.entry_json ? JSON.parse(row.entry_json) as { name?: Record<string, string> } : null
      const plugin = nameIn(entry?.name ?? (row.plugin_id ? await catalogName(row.plugin_id) : null), row.locale, row.plugin_id ?? '')
      const url = `${env.PORTAL_ORIGIN}/changes/${row.number ?? row.change_id}`
      const comment = !live && typeof detail?.comment === 'string' ? detail.comment : undefined
      const message = buildMail({ kind: live ? 'live' : row.stage, locale: row.locale, plugin, url, origin: env.PORTAL_ORIGIN, comment })
      if ((await sendMail(env, row.email, message.subject, message.text, message.html)).ok)
        sent++
    }
  }
  if (results.length)
    await setState(env, 'mail.event', String(results.at(-1)!.id))
  return sent
}

const DAY = 86400
const AUDIT_KEEP = 365 * DAY

/** Daily work: the glossary read again, download totals written down, audit records past a year removed. */
export async function daily(env: Env): Promise<boolean> {
  const t = now()
  const last = Number(await state(env, 'daily.ran') ?? 0)
  if (t - last < DAY)
    return false
  await setState(env, 'daily.ran', String(t))
  await env.DB.prepare('DELETE FROM audit WHERE at < ?').bind(t - AUDIT_KEEP).run()
  await syncGlossary(env).catch(error => console.error('glossary sync failed', error))
  await snapshotDownloads(env).catch(error => console.error('download snapshot failed', error))
  return true
}

export async function scheduled(env: Env) {
  await remind(env)
  await mail(env)
  await daily(env)
}
