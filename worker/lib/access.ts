import type { Env } from '../env'
import type { RepoPermission } from './github'
import { github, GitHubError, permissionOf } from './github'
import { now } from './time'

export type Role = 'admin' | 'publisher' | 'translator'

// How long a permission read from GitHub is trusted. Someone removed on
// GitHub loses access once it runs out.
export const ACCESS_SECONDS = 300

export function roleOf(permission: RepoPermission): Role | null {
  switch (permission) {
    case 'admin':
      return 'admin'
    case 'maintain':
    case 'write':
      return 'publisher'
    case 'triage':
      return 'translator'
    default:
      return null
  }
}

const RANK: Record<Role, number> = { translator: 1, publisher: 2, admin: 3 }

export function atLeast(role: Role | null, needed: Role): boolean {
  return role !== null && RANK[role] >= RANK[needed]
}

export interface RepoAccess {
  repo: string
  repoId: number | null
  owner: RepoOwner | null
  permission: RepoPermission
  role: Role | null
  checkedAt: number
}

export interface RepoOwner {
  id: number
  login: string
  kind: 'user' | 'organization'
  avatarUrl: string | null
}

interface RepoResponse {
  id: number
  full_name: string
  owner: { id: number, login: string, type: string, avatar_url: string }
  permissions?: Record<string, boolean>
}

interface CachedRow {
  repo_id: number | null
  owner_login: string | null
  permission: RepoPermission
  checked_at: number
}

async function upsertOwner(db: D1Database, owner: RepoOwner): Promise<void> {
  const t = now()
  await db.prepare(
    `INSERT INTO owners (github_id, github_login, kind, avatar_url, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT (github_id) DO UPDATE SET github_login = ?2, kind = ?3, avatar_url = ?4, updated_at = ?5`,
  ).bind(owner.id, owner.login, owner.kind, owner.avatarUrl, t).run()
}

async function ownerByLogin(db: D1Database, login: string | null): Promise<RepoOwner | null> {
  if (!login)
    return null
  const row = await db.prepare(
    `SELECT github_id, github_login, kind, avatar_url FROM owners WHERE github_login = ? COLLATE NOCASE AND kind != 'vendor'`,
  ).bind(login).first<{ github_id: number, github_login: string, kind: 'user' | 'organization', avatar_url: string | null }>()
  return row ? { id: row.github_id, login: row.github_login, kind: row.kind, avatarUrl: row.avatar_url } : null
}

// The user's access to a plugin repository, read with their own token and
// cached for a few minutes. A repository they cannot read gives no access.
export async function repoAccess(env: Env, userId: number, token: string, repo: string, fresh = false): Promise<RepoAccess> {
  if (!fresh) {
    const cached = await env.DB.prepare(
      'SELECT repo_id, owner_login, permission, checked_at FROM repo_permissions WHERE user_id = ? AND repo_full_name = ?',
    ).bind(userId, repo).first<CachedRow>()
    if (cached && now() - cached.checked_at < ACCESS_SECONDS) {
      return {
        repo,
        repoId: cached.repo_id,
        owner: await ownerByLogin(env.DB, cached.owner_login),
        permission: cached.permission,
        role: roleOf(cached.permission),
        checkedAt: cached.checked_at,
      }
    }
  }

  let repoId: number | null = null
  let owner: RepoOwner | null = null
  let permission: RepoPermission = 'other'
  const checkedAt = now()
  try {
    const response = await github<RepoResponse>(`/repos/${repo}`, token)
    repoId = response.id
    owner = {
      id: response.owner.id,
      login: response.owner.login,
      kind: response.owner.type === 'Organization' ? 'organization' : 'user',
      avatarUrl: response.owner.avatar_url,
    }
    permission = permissionOf(response)
    await upsertOwner(env.DB, owner)
  }
  catch (error) {
    if (!(error instanceof GitHubError) || (error.status !== 404 && error.status !== 403))
      throw error
  }
  await env.DB.prepare(
    `INSERT INTO repo_permissions (user_id, repo_full_name, repo_id, owner_login, permission, checked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (user_id, repo_full_name) DO UPDATE SET repo_id = ?3, owner_login = ?4, permission = ?5, checked_at = ?6`,
  ).bind(userId, repo, repoId, owner?.login ?? null, permission, checkedAt).run()
  return { repo, repoId, owner, permission, role: roleOf(permission), checkedAt }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length })
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
