import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { catalogRef, newestFirst, noteCatalogHead } from '../worker/lib/catalog'

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

describe('release order', () => {
  it('reads releases newest first whatever order the catalog keeps', () => {
    expect(newestFirst([{ version: '0.1.0' }, { version: '0.2.0-beta.1' }, { version: '0.1.1' }, { version: '0.2.0' }]).map(r => r.version))
      .toEqual(['0.2.0', '0.2.0-beta.1', '0.1.1', '0.1.0'])
  })
})
