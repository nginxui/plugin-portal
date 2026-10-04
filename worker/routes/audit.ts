import type { AppEnv, Env } from '../env'
import { Hono } from 'hono'
import { now } from '../lib/time'
import { requireMaintainer, requireSession } from '../middleware/auth'

// The audit log for maintainers: every portal action, filtered and paged by
// id, or exported whole as CSV or JSON.

const KINDS = {
  review: `a.action LIKE 'review.%'`,
  self_service: `a.action IN ('change.self_service', 'store.submit', 'community.decide')`,
  submission: `a.action = 'change.submit'`,
  maintainer: `a.action LIKE 'maintain.%'`,
  ai: `a.action = 'ai.draft'`,
  settings: `(a.action LIKE 'ai.provider_%' OR a.action LIKE 'community.enable' OR a.action LIKE 'community.disable')`,
  system: `a.actor_id IS NULL`,
  account: `a.action LIKE 'auth.%'`,
} as const

type Kind = keyof typeof KINDS

const PAGE = 50
const EXPORT_LIMIT = 5000
const DAY = 86400

interface AuditRow {
  id: number
  actor_id: number | null
  login: string | null
  avatar_url: string | null
  action: string
  subject: string | null
  detail_json: string | null
  at: number
}

export function kindOf(action: string, actorId: number | null): Kind {
  if (actorId === null)
    return 'system'
  if (action.startsWith('review.'))
    return 'review'
  if (action === 'change.self_service' || action === 'store.submit' || action === 'community.decide')
    return 'self_service'
  if (action === 'change.submit')
    return 'submission'
  if (action.startsWith('maintain.'))
    return 'maintainer'
  if (action === 'ai.draft')
    return 'ai'
  if (action.startsWith('ai.provider_') || action === 'community.enable' || action === 'community.disable')
    return 'settings'
  return 'account'
}

// Where a record can be checked: a commit or pull request in the catalog
// repository, else the portal change.
function recordOf(env: Env, detail: Record<string, unknown> | null) {
  const repo = env.CATALOG_REPO
  if (typeof detail?.commit === 'string')
    return { label: detail.commit.slice(0, 7), url: `https://github.com/${repo}/commit/${detail.commit}` }
  if (typeof detail?.pr === 'number')
    return { label: `#${detail.pr}`, url: `https://github.com/${repo}/pull/${detail.pr}` }
  if (typeof detail?.change === 'string')
    return { label: detail.change, url: `/changes/${detail.change}` }
  return null
}

function present(env: Env, row: AuditRow) {
  const detail = row.detail_json ? JSON.parse(row.detail_json) as Record<string, unknown> : null
  return {
    id: row.id,
    at: row.at,
    actor: row.login,
    actorAvatar: row.avatar_url,
    kind: kindOf(row.action, row.actor_id),
    action: row.action,
    subject: row.subject,
    detail,
    record: recordOf(env, detail),
  }
}

function filters(query: Record<string, string | undefined>) {
  const where: string[] = []
  const binds: (string | number)[] = []
  if (query.kind && query.kind in KINDS)
    where.push(KINDS[query.kind as Kind])
  if (query.actor) {
    where.push('u.login = ? COLLATE NOCASE')
    binds.push(query.actor.replace(/^@/, ''))
  }
  if (query.subject) {
    where.push('a.subject LIKE ? ESCAPE \'\\\'')
    binds.push(`%${query.subject.replace(/[\\%_]/g, m => `\\${m}`)}%`)
  }
  const days = Number(query.days)
  if (Number.isInteger(days) && days > 0) {
    where.push('a.at >= ?')
    binds.push(now() - days * DAY)
  }
  return { where, binds }
}

const SELECT = `SELECT a.*, u.login, u.avatar_url FROM audit a LEFT JOIN users u ON u.id = a.actor_id`

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  // A leading formula character would run in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const audit = new Hono<AppEnv>()

audit.use('*', requireSession, requireMaintainer)

audit.get('/', async (c) => {
  const query = c.req.query()
  const { where, binds } = filters(query)
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  if (query.format === 'csv' || query.format === 'json') {
    const { results } = await c.env.DB.prepare(`${SELECT} ${clause} ORDER BY a.id DESC LIMIT ${EXPORT_LIMIT}`).bind(...binds).all<AuditRow>()
    const rows = results.map(row => present(c.env, row))
    const stamp = new Date().toISOString().slice(0, 10)
    if (query.format === 'json') {
      return c.body(JSON.stringify(rows, null, 2), 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-${stamp}.json"`,
      })
    }
    const lines = [['time', 'actor', 'kind', 'action', 'subject', 'record', 'detail'].join(',')]
    for (const row of rows)
      lines.push([new Date(row.at * 1000).toISOString(), row.actor ?? 'portal', row.kind, row.action, row.subject, row.record?.url, row.detail].map(csvCell).join(','))
    return c.body(`${lines.join('\r\n')}\r\n`, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${stamp}.csv"`,
    })
  }

  const before = Number(query.before)
  const paged = Number.isInteger(before) && before > 0 ? [...where, 'a.id < ?'] : where
  const pagedBinds = Number.isInteger(before) && before > 0 ? [...binds, before] : binds
  const [page, total] = await Promise.all([
    c.env.DB.prepare(`${SELECT} ${paged.length ? `WHERE ${paged.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT ${PAGE + 1}`).bind(...pagedBinds).all<AuditRow>(),
    c.env.DB.prepare(`SELECT count(*) AS n FROM audit a LEFT JOIN users u ON u.id = a.actor_id ${clause}`).bind(...binds).first<{ n: number }>(),
  ])
  const rows = page.results.slice(0, PAGE)
  return c.json({
    entries: rows.map(row => present(c.env, row)),
    total: total?.n ?? 0,
    next: page.results.length > PAGE ? rows[rows.length - 1].id : null,
  })
})
