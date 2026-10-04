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
}

export function newChangeId(): string {
  return `c_${randomToken(12)}`
}

export async function getChange(env: Env, id: string): Promise<ChangeRow | null> {
  return env.DB.prepare('SELECT * FROM changes WHERE id = ?').bind(id).first<ChangeRow>()
}

export function event(env: Env, change: string, stage: string, actorId: number | null, detail?: unknown) {
  return env.DB.prepare('INSERT INTO change_events (change_id, stage, actor_id, detail_json, at) VALUES (?, ?, ?, ?, ?)')
    .bind(change, stage, actorId, detail === undefined ? null : JSON.stringify(detail), now())
}
