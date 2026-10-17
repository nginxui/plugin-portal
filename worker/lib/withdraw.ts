import type { Env } from '../env'
import type { ChangeRow } from './changes'
import { audit } from './audit'
import { botEnabled, botToken } from './bot'
import { event } from './changes'
import { dispatchApply } from './deployApp'
import { github } from './github'
import { now } from './time'

/**
 * Withdraws an open change. A pull request of the bot on the author's
 * repository is closed by the bot; one in the catalog by apply.yml, since
 * only its app may close it. replacedBy names the change that takes over.
 */
export async function withdrawChange(env: Env, change: ChangeRow, actor: { id: number, login: string }, replacedBy?: string): Promise<void> {
  const payload = change.payload_json ? JSON.parse(change.payload_json) as { delivery?: string, repo?: string } : {}
  if ((change.kind === 'store' || change.kind === 'translations') && payload.delivery === 'bot' && change.pr_number && payload.repo && await botEnabled(env)) {
    await github(`/repos/${payload.repo}/pulls/${change.pr_number}`, await botToken(env), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    }).catch(error => console.error('closing the pull request failed', error))
  }
  else if (change.pr_number && change.stage === 'review') {
    await dispatchApply(env, change.id, { kind: 'close', pr_number: change.pr_number, submitter: { login: actor.login, id: actor.id } })
      .catch(error => console.error('dispatch failed', error))
  }
  const t = now()
  await env.DB.batch([
    env.DB.prepare(`UPDATE changes SET state = 'withdrawn', waiting_on = NULL, updated_at = ? WHERE id = ?`).bind(t, change.id),
    event(env, change.id, 'withdrawn', actor.id, replacedBy ? { replaced_by: replacedBy } : undefined),
    env.DB.prepare(`UPDATE suggestions SET change_id = NULL WHERE change_id = ? AND state = 'accepted'`).bind(change.id),
  ])
  await audit(env.DB, { actorId: actor.id, action: 'change.withdraw', subject: change.plugin_id ?? undefined, detail: replacedBy ? { change: change.id, replaced_by: replacedBy } : { change: change.id } })
}
