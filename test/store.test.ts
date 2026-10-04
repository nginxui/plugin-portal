import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, json, mockFetch, signIn } from './helpers'

const RAW = 'https://raw.githubusercontent.com'
const ID = 'io.github.octo-author.geoip'
const listing = { id: ID, name: { en: 'GeoIP Access' }, repository_url: 'https://github.com/octo-author/geoip', trust: 'community', releases: [{ version: '1.0.0', release_notes_url: 'https://github.com/octo-author/geoip/releases/tag/v1.0.0' }] }
const manifest = { id: ID, name: 'GeoIP Access', description: 'Allow or deny by country.', i18n: { zh_CN: { description: '按国家限制访问。', screenshot_captions: { map: '地图' } } }, screenshots: [{ id: 'map', path: 'docs/map.png', caption: 'Map' }] }
const repo = { id: 77, full_name: 'octo-author/geoip', default_branch: 'main', owner: { id: 4242, login: 'octo-author', type: 'User', avatar_url: '' }, permissions: { admin: true, push: true, pull: true } }

let dispatched: { change: string, payload: string }[] = []
let entry: Record<string, unknown> = { id: ID, name: { en: 'GeoIP Access' } }

function routes(): Route[] {
  return [
    url => url.href === `${env.CATALOG_URL}/v1/index.json` ? json({ plugins: [listing] }) : undefined,
    url => url.href === `${RAW}/${env.CATALOG_REPO}/main/plugins/${ID}.json` ? json(entry) : undefined,
    url => url.href === `${RAW}/octo-author/geoip/v1.0.0/plugin.json` ? json(manifest) : undefined,
    url => url.href === `${RAW}/octo-author/geoip/v1.0.0/README.md` ? new Response('# GeoIP') : undefined,
    url => url.href === 'https://api.github.com/repos/octo-author/geoip' ? json(repo) : undefined,
    url => url.pathname === `/repos/${env.CATALOG_REPO}/installation` ? json({ id: 9 }) : undefined,
    url => url.pathname === '/app/installations/9/access_tokens' ? json({ token: 'ghs_actions' }) : undefined,
    async (url, init) => {
      if (url.pathname !== `/repos/${env.CATALOG_REPO}/actions/workflows/apply.yml/dispatches`)
        return undefined
      dispatched.push(JSON.parse(await new Response(init.body).text()).inputs)
      return new Response(null, { status: 204 })
    },
    url => url.hostname === 'raw.githubusercontent.com' ? new Response('not found', { status: 404 }) : undefined,
  ]
}

async function useDeployKey() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer)
  Object.assign(env, { DEPLOY_APP_ID: '123', DEPLOY_APP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` })
}

// A minimal lossless WebP header of the given size.
function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([...'RIFF'].map(c => c.charCodeAt(0)), 0)
  bytes.set([...'WEBPVP8L'].map(c => c.charCodeAt(0)), 8)
  const w = width - 1
  const h = height - 1
  bytes[21] = w & 0xFF
  bytes[22] = ((w >> 8) & 0x3F) | ((h & 0x3) << 6)
  bytes[23] = (h >> 2) & 0xFF
  bytes[24] = (h >> 10) & 0xF
  return bytes
}

beforeEach(async () => {
  dispatched = []
  entry = { id: ID, name: { en: 'GeoIP Access' } }
  await caches.default.delete(`${env.CATALOG_URL}/v1/index.json`)
  await useDeployKey()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function signedIn() {
  const cookie = await signIn()
  vi.restoreAllMocks()
  mockFetch(...routes())
  return cookie
}

describe('store editor', () => {
  it('starts from the manifest of the listed release', async () => {
    const cookie = await signedIn()
    const body = await (await call(`/api/plugins/${ID}/store`, { cookie })).json() as { source: string, doc: { description: Record<string, string>, screenshots: { caption: Record<string, string> }[] }, images: Record<string, string>, readme: string, canEdit: { all: boolean } }
    expect(body.source).toBe('release')
    expect(body.doc.description).toEqual({ en: 'Allow or deny by country.', zh_CN: '按国家限制访问。' })
    expect(body.doc.screenshots[0].caption).toEqual({ en: 'Map', zh_CN: '地图' })
    expect(body.images['docs/map.png']).toBe(`${RAW}/octo-author/geoip/v1.0.0/docs/map.png`)
    expect(body.readme).toBe('# GeoIP')
    expect(body.canEdit.all).toBe(true)
  })

  it('keeps a draft and lists what it changes', async () => {
    const cookie = await signedIn()
    const doc = { name: { en: 'GeoIP Access', ja_JP: 'GeoIP アクセス' }, description: { en: 'Allow or deny by country.', zh_CN: '按国家或地区限制访问。' }, screenshots: manifest.screenshots.map(s => ({ id: s.id, path: s.path, caption: { en: 'Map', zh_CN: '地图' } })) }
    const saved = await (await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc } })).json() as { problems: string[] }
    expect(saved.problems).toEqual([])
    const body = await (await call(`/api/plugins/${ID}/store`, { cookie })).json() as { items: { label: string, review: boolean }[] }
    expect(body.items).toEqual([
      { field: 'name', locale: 'ja_JP', label: 'name.ja_JP', review: true },
      { field: 'description', locale: 'zh_CN', label: 'description.zh_CN', review: false },
    ])
  })

  it('refuses names claiming to be official', async () => {
    const cookie = await signedIn()
    const saved = await (await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { name: { en: 'Official GeoIP' } } } })).json() as { problems: string[] }
    expect(saved.problems).toEqual(['name.en: holds official'])
    expect((await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })).status).toBe(422)
  })

  it('sends a catalog hosted document through apply.yml', async () => {
    const cookie = await signedIn()
    entry = { ...entry, store: { source: 'catalog' } }
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { description: { en: 'Better.' } } } })
    const response = await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })
    expect(response.status).toBe(201)
    const payload = JSON.parse(dispatched[0].payload)
    expect(payload).toMatchObject({ kind: 'store_update', plugin_id: ID, doc: { description: { en: 'Better.' } }, set_source: null })
    expect(await env.DB.prepare(`SELECT kind, stage FROM changes WHERE kind = 'store'`).first()).toEqual({ kind: 'store', stage: 'checks' })
    expect(await env.DB.prepare('SELECT count(*) AS n FROM store_drafts').first()).toEqual({ n: 0 })
  })

  it('gives a patch for the repository and moves the source in a reviewed change', async () => {
    const cookie = await signedIn()
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { description: { en: 'Better.' } }, source: 'repo-branch' } })
    const result = await (await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })).json() as { change: string, moveChange: string, delivery: string }
    expect(result.delivery).toBe('patch')
    expect(JSON.parse(dispatched[0].payload)).toMatchObject({ kind: 'entry_update', operations: { store: { source: 'repo', follow: 'branch' } } })
    expect(dispatched[0].change).toBe(result.moveChange)
    const zip = await call(`/api/changes/${result.change}/patch`, { cookie })
    expect(zip.headers.get('Content-Type')).toBe('application/zip')
    const text = new TextDecoder().decode(await zip.arrayBuffer())
    expect(text).toContain('plugin.store.json')
    expect(text).toContain('"Better."')
  })

  it('takes screenshots as 16:10 WebP only', async () => {
    const cookie = await signedIn()
    const upload = (bytes: Uint8Array) => call('/api/media', { method: 'POST', mutate: true, cookie, body: bytes, headers: { 'Content-Type': 'image/webp' } })
    expect((await upload(new TextEncoder().encode('not an image'))).status).toBe(415)
    expect((await upload(webp(1280, 1280))).status).toBe(422)
    const ok = await upload(webp(1280, 800))
    expect(ok.status).toBe(201)
    const { path, url } = await ok.json() as { path: string, url: string }
    expect(path).toMatch(/^media:[0-9a-f]{64}$/)
    const served = await call(url)
    expect(served.headers.get('Cache-Control')).toContain('immutable')
  })
})
