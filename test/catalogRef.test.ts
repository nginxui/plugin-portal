import { afterEach, describe, expect, it } from 'vitest'
import { catalogRef, noteCatalogHead } from '../worker/lib/catalog'

afterEach(async () => {
  await caches.default.delete(`https://portal.cache/${encodeURIComponent('catalog-head')}`)
})

describe('catalog ref', () => {
  it('reads main until a commit is known, then that commit', async () => {
    expect(await catalogRef()).toBe('main')
    await noteCatalogHead('not a sha')
    expect(await catalogRef()).toBe('main')
    const sha = 'a'.repeat(40)
    await noteCatalogHead(sha)
    expect(await catalogRef()).toBe(sha)
  })
})
