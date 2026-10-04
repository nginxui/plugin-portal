const API = 'https://api.github.com'
const USER_AGENT = 'nginxui-plugin-portal'

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export async function github<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/vnd.github+json')
  headers.set('X-GitHub-Api-Version', '2022-11-28')
  headers.set('User-Agent', USER_AGENT)
  if (token)
    headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API}${path}`, { ...init, headers })
  if (!response.ok)
    throw new GitHubError(response.status, `GitHub ${init.method ?? 'GET'} ${path}: ${response.status}`)
  if (response.status === 204)
    return undefined as T
  return response.json() as Promise<T>
}

export interface UserTokens {
  accessToken: string
  // Absent when the app does not expire user tokens.
  expiresAt: number | null
  refreshToken: string | null
  refreshExpiresAt: number | null
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

async function tokenRequest(params: Record<string, string>, now: number): Promise<UserTokens> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(params),
  })
  const body = await response.json() as TokenResponse
  if (!response.ok || !body.access_token)
    throw new GitHubError(response.status, `token exchange failed: ${body.error ?? response.status}`)
  return {
    accessToken: body.access_token,
    expiresAt: body.expires_in ? now + body.expires_in : null,
    refreshToken: body.refresh_token ?? null,
    refreshExpiresAt: body.refresh_token_expires_in ? now + body.refresh_token_expires_in : null,
  }
}

export function exchangeCode(input: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  verifier: string
}, now: number): Promise<UserTokens> {
  return tokenRequest({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  }, now)
}

export function refreshTokens(input: {
  clientId: string
  clientSecret: string
  refreshToken: string
}, now: number): Promise<UserTokens> {
  return tokenRequest({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  }, now)
}

export interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatar_url: string
}

export function currentUser(token: string): Promise<GitHubUser> {
  return github<GitHubUser>('/user', token)
}

export type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'other'

interface RepoResponse {
  id: number
  full_name: string
  permissions?: { admin?: boolean, maintain?: boolean, push?: boolean, triage?: boolean, pull?: boolean }
}

export function permissionOf(repo: RepoResponse): RepoPermission {
  const p = repo.permissions ?? {}
  if (p.admin)
    return 'admin'
  if (p.maintain)
    return 'maintain'
  if (p.push)
    return 'write'
  if (p.triage)
    return 'triage'
  return 'other'
}

export async function repoPermission(token: string, fullName: string): Promise<{ repoId: number, permission: RepoPermission }> {
  const repo = await github<RepoResponse>(`/repos/${fullName}`, token)
  return { repoId: repo.id, permission: permissionOf(repo) }
}

export function canWrite(permission: RepoPermission): boolean {
  return permission === 'admin' || permission === 'maintain' || permission === 'write'
}
