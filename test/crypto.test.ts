import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { open, pkceChallenge, seal } from '../worker/lib/crypto'

describe('seal', () => {
  it('round trips within the same context', async () => {
    const sealed = await seal(env.SESSION_KEY, 'ghu_secret', 'session:a:access')
    expect(sealed).not.toContain('ghu_secret')
    expect(await open(env.SESSION_KEY, sealed, 'session:a:access')).toBe('ghu_secret')
  })

  it('refuses a value moved to another context', async () => {
    const sealed = await seal(env.SESSION_KEY, 'ghu_secret', 'session:a:access')
    await expect(open(env.SESSION_KEY, sealed, 'session:b:access')).rejects.toThrow()
  })
})

describe('pkceChallenge', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})
