import type { Env } from '../env'
import { randomToken } from './crypto'
import { now } from './time'

export type Stage = 'submitted' | 'checks' | 'review' | 'merged' | 'live'

export interface ChangeRow {
  id: string
  plugin_id: string | null
  author_id: number
  kind: string
  class: string
  entry_json: string | null
  state: 'draft' | 'open' | 'merged' | 'live' | 'rejected' | 'withdrawn' | 'failed'
  stage: Stage
  waiting_on: 'author' | 'maintainer' | 'system' | null
  pr_number: number | null
  commit_sha: string | null
  deployed_at: number | null
  created_at: number
  updated_at: number
  payload_json: string | null
  dispatched_at: number | null
  outcome_json: string | null
  number: number | null
}

/** The number of the next change, inside its INSERT. */
export const NEXT_NUMBER = '(SELECT coalesce(max(number), 0) + 1 FROM changes)'

export function newChangeId(): string {
  return `c_${randomToken(12)}`
}

/** A change by its id or by its number. */
export async function getChange(env: Env, id: string): Promise<ChangeRow | null> {
  if (/^\d{1,9}$/.test(id))
    return env.DB.prepare('SELECT * FROM changes WHERE number = ?').bind(Number(id)).first<ChangeRow>()
  return env.DB.prepare('SELECT * FROM changes WHERE id = ?').bind(id).first<ChangeRow>()
}

export function event(env: Env, change: string, stage: string, actorId: number | null, detail?: unknown) {
  return env.DB.prepare('INSERT INTO change_events (change_id, stage, actor_id, detail_json, at) VALUES (?, ?, ?, ?, ?)')
    .bind(change, stage, actorId, detail === undefined ? null : JSON.stringify(detail), now())
}
