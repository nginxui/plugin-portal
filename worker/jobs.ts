import type { Env } from './env'
import { event } from './lib/changes'
import { sendMail } from './lib/mail'
import { now } from './lib/time'

// Work on a schedule: reminders for changes that wait on their author, and
// email for the stages users asked to hear about.

const REMIND_AFTER = 18 * 3600
const ACTION_STAGES = new Set(['changes_requested', 'reminder', 'rejected'])

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
    `SELECT e.id, e.stage, e.change_id, c.kind, c.plugin_id, p.email, p.email_on_action, p.email_on_live
     FROM change_events e JOIN changes c ON c.id = e.change_id JOIN notify_prefs p ON p.user_id = c.author_id
     WHERE e.id > ? AND p.email IS NOT NULL ORDER BY e.id LIMIT 200`,
  ).bind(last).all<{ id: number, stage: string, change_id: string, kind: string, plugin_id: string | null, email: string, email_on_action: number, email_on_live: number }>()
  let sent = 0
  for (const row of results) {
    const action = row.email_on_action && ACTION_STAGES.has(row.stage)
    const live = row.email_on_live && row.stage === 'live'
    if (action || live) {
      const url = `${env.PORTAL_ORIGIN}/changes/${row.change_id}`
      const subject = live ? `${row.plugin_id ?? 'Your plugin'} is live in the Nginx UI catalog` : `${row.plugin_id ?? 'Your change'} waits for you in the Nginx UI developer portal`
      const text = live
        ? `Your change to ${row.plugin_id} is live in the catalog. Nginx UI shows it at its next marketplace refresh.\n\n${url}`
        : `Your change to ${row.plugin_id} waits for you.\n\n${url}`
      if (await sendMail(env, row.email, subject, text))
        sent++
    }
  }
  if (results.length)
    await setState(env, 'mail.event', String(results.at(-1)!.id))
  return sent
}

export async function scheduled(env: Env) {
  await remind(env)
  await mail(env)
}
