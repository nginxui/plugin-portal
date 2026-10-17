import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { catalogRef, noteCatalogHead } from '../worker/lib/catalog'

describe('catalog ref', () => {
  it('reads main until a commit is known, then that commit', async () => {
    expect(await catalogRef(env)).toBe('main')
    await noteCatalogHead(env, 'not a sha')
    expect(await catalogRef(env)).toBe('main')
    const sha = 'a'.repeat(40)
    await noteCatalogHead(env, sha)
    expect(await catalogRef(env)).toBe(sha)
    await noteCatalogHead(env, 'b'.repeat(40))
    expect(await catalogRef(env)).toBe('b'.repeat(40))
  })
})
