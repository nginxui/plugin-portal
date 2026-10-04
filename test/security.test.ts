import { describe, expect, it } from 'vitest'
import { call } from './helpers'

describe('security', () => {
  it('answers no preflight', async () => {
    const response = await call('/api/auth/logout', { method: 'OPTIONS', headers: { Origin: 'https://demo.nginxui.com' } })
    expect(response.status).toBe(405)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('refuses a mutation from a sibling origin', async () => {
    const response = await call('/api/auth/logout', {
      method: 'POST',
      headers: { 'Origin': 'https://demo.nginxui.com', 'X-Portal-Request': '1' },
    })
    expect(response.status).toBe(403)
  })

  it('refuses a mutation without the request header', async () => {
    const response = await call('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://portal.test' } })
    expect(response.status).toBe(403)
  })

  it('accepts a mutation from the portal', async () => {
    const response = await call('/api/auth/logout', { method: 'POST', mutate: true })
    expect(response.status).toBe(204)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
