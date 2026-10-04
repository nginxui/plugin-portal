import { now } from './time'

export async function audit(db: D1Database, entry: {
  actorId: number | null
  action: string
  subject?: string
  detail?: unknown
}): Promise<void> {
  await db.prepare('INSERT INTO audit (actor_id, action, subject, detail_json, at) VALUES (?, ?, ?, ?, ?)')
    .bind(entry.actorId, entry.action, entry.subject ?? null, entry.detail === undefined ? null : JSON.stringify(entry.detail), now())
    .run()
}
