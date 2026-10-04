export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = init.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD')
    headers.set('X-Portal-Request', '1')
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const response = await fetch(`/api${path}`, { ...init, method, headers, body, credentials: 'same-origin' })
  if (response.status === 204)
    return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new ApiError(response.status, (data as { error?: string }).error ?? 'unknown')
  return data as T
}
