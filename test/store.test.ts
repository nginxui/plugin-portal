import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, json, mockFetch, signIn } from './helpers'

const RAW = 'https://raw.githubusercontent.com'
const ID = 'io.github.octo-author.geoip'
const listing = { id: ID, name: { en: 'GeoIP Access' }, repository_url: 'https://github.com/octo-author/geoip', trust: 'community', releases: [{ version: '1.0.0', release_notes_url: 'https://github.com/octo-author/geoip/releases/tag/v1.0.0' }] }
const manifest = { id: ID, name: 'GeoIP Access', description: 'Allow or deny by country.', permissions: ['network'], permission_reasons: { network: 'Looks up the country of an address.' }, i18n: { zh_CN: { description: '按国家限制访问。', screenshot_captions: { map: '地图' } } }, screenshots: [{ id: 'map', path: 'docs/map.png', caption: 'Map' }] }
const repo = { id: 77, full_name: 'octo-author/geoip', default_branch: 'main', owner: { id: 4242, login: 'octo-author', type: 'User', avatar_url: '' }, permissions: { admin: true, push: true, pull: true } }

let dispatched: { change: string, payload: string }[] = []
let entry: Record<string, unknown> = { id: ID, name: { en: 'GeoIP Access' } }
// store/<id>/store.json in the catalog, for a catalog hosted plugin.
let catalogDoc: unknown = null

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
    url => catalogDoc && url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith(`/store/${ID}/store.json`) ? json(catalogDoc) : undefined,
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
  catalogDoc = null
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

  it('sends names and other texts of a catalog hosted plugin as two changes', async () => {
    const cookie = await signedIn()
    entry = { ...entry, store: { source: 'catalog' } }
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { name: { en: 'GeoIP Access', ja_JP: 'GeoIP アクセス' }, description: { en: 'Better.' } } } })
    const result = await (await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })).json() as { change: string, nameChange: string }
    expect(result.nameChange).toBeTruthy()
    expect(dispatched.map(d => d.change)).toEqual([result.change, result.nameChange])
    expect(JSON.parse(dispatched[0].payload)).toMatchObject({ kind: 'store_update', fields: [], texts: { description: { en: 'Better.' } }, readme: null })
    expect(JSON.parse(dispatched[1].payload)).toMatchObject({ kind: 'store_update', fields: [], texts: { name: { ja_JP: 'GeoIP アクセス' } }, readme: null })

    // While the names wait for review, other texts may go ahead, more names may not.
    await env.DB.prepare(`UPDATE changes SET state = 'merged' WHERE id = ?`).bind(result.change).run()
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { name: { en: 'GeoIP Access' }, description: { en: 'Best.' } } } })
    expect((await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })).status).toBe(201)
    await env.DB.prepare(`UPDATE changes SET state = 'merged' WHERE id != ?`).bind(result.nameChange).run()
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { name: { en: 'GeoIP Access', ko_KR: 'GeoIP 접근' } } } })
    const names = await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })
    expect(names.status).toBe(409)
    expect(await names.json()).toEqual({ error: 'names_pending' })
  })

  it('replaces names a maintainer sent back with the next submission', async () => {
    const cookie = await signedIn()
    entry = { ...entry, store: { source: 'catalog' } }
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { name: { en: 'GeoIP Access', ja_JP: 'GeoIP アクセス' } } } })
    const first = await (await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })).json() as { change: string }
    await env.DB.prepare(`UPDATE changes SET stage = 'review', waiting_on = 'author', pr_number = 41 WHERE id = ?`).bind(first.change).run()
    const number = (await env.DB.prepare('SELECT number FROM changes WHERE id = ?').bind(first.change).first<{ number: number }>())!.number
    expect(await (await call(`/api/plugins/${ID}/store`, { cookie })).json()).toMatchObject({ pending: null, replaces: number })

    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { name: { en: 'GeoIP Access', ja_JP: 'GeoIP アクセス制御' } } } })
    const response = await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })
    expect(response.status).toBe(201)
    const second = await response.json() as { change: string }
    expect(await env.DB.prepare('SELECT state FROM changes WHERE id = ?').bind(first.change).first()).toEqual({ state: 'withdrawn' })
    expect(await env.DB.prepare(`SELECT detail_json FROM change_events WHERE change_id = ? AND stage = 'withdrawn'`).bind(first.change).first()).toEqual({ detail_json: JSON.stringify({ replaced_by: second.change }) })
    // The pull request of the old change is closed by apply.yml.
    expect(dispatched.map(d => JSON.parse(d.payload).kind)).toEqual(['store_update', 'close', 'store_update'])
  })

  it('lets the members of a vendor edit the store texts of its plugin', async () => {
    const cookie = await signIn()
    vi.restoreAllMocks()
    const vendorId = 'dev.acme.notes'
    const t = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO owners (id, kind, name, created_at, updated_at) VALUES (901, 'vendor', 'Acme', ?, ?)`).bind(t, t),
      env.DB.prepare(`INSERT INTO vendor_members (owner_id, user_id, role, added_by, added_at) VALUES (901, 4242, 'admin', 4242, ?)`).bind(t),
      env.DB.prepare(`INSERT INTO plugins (plugin_id, owner_id, state, created_at, updated_at) VALUES (?, 901, 'listed', ?, ?)`).bind(vendorId, t, t),
    ])
    mockFetch(
      url => url.href === `${env.CATALOG_URL}/v1/index.json` ? json({ plugins: [{ id: vendorId, name: { en: 'Notes' }, trust: 'verified', releases: [{ version: '1.0.0' }] }] }) : undefined,
      url => url.href === `${RAW}/${env.CATALOG_REPO}/main/plugins/${vendorId}.json` ? json({ id: vendorId, name: { en: 'Notes' }, store: { source: 'catalog' } }) : undefined,
      ...routes(),
    )
    const state = await (await call(`/api/plugins/${vendorId}/store`, { cookie })).json() as { canEdit: { all: boolean } }
    expect(state.canEdit.all).toBe(true)
    // The plugin is theirs in My plugins and on its own page.
    const mine = await (await call('/api/plugins/mine', { cookie })).json() as { plugins: { id: string, role: string }[] }
    expect(mine.plugins).toContainEqual(expect.objectContaining({ id: vendorId, role: 'admin' }))
    expect((await call(`/api/plugins/${vendorId}`, { cookie })).status).toBe(200)
    await call(`/api/plugins/${vendorId}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { description: { en: 'Notes for teams.' } } } })
    expect((await call(`/api/plugins/${vendorId}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })).status).toBe(201)
    expect(JSON.parse(dispatched[0].payload).eligibility).toBe('@octo-author is an admin of the vendor Acme')
  })

  it('moves a draft onto texts that went live meanwhile', async () => {
    const cookie = await signedIn()
    entry = { ...entry, store: { source: 'catalog' } }
    catalogDoc = { name: { en: 'GeoIP Access' }, description: { en: 'By country.' } }
    const loaded = await (await call(`/api/plugins/${ID}/store`, { cookie })).json() as { doc: unknown }
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { name: { en: 'GeoIP Access' }, description: { en: 'By country.', ja_JP: '国別。' } }, base: loaded.doc } })
    // A French text went live while the draft waited.
    catalogDoc = { name: { en: 'GeoIP Access' }, description: { en: 'By country.', fr_FR: 'Par pays.' } }
    const state = await (await call(`/api/plugins/${ID}/store`, { cookie })).json() as { draft: { doc: { description: Record<string, string> } }, items: { label: string }[] }
    expect(state.draft.doc.description).toEqual({ en: 'By country.', ja_JP: '国別。', fr_FR: 'Par pays.' })
    expect(state.items.map(i => i.label)).toEqual(['description.ja_JP'])
  })

  it('gives a patch for the repository and moves the source in a self service change', async () => {
    const cookie = await signedIn()
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { description: { en: 'Better.' } }, source: 'repo-branch' } })
    const result = await (await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })).json() as { change: string, moveChange: string, delivery: string }
    expect(result.delivery).toBe('patch')
    expect(JSON.parse(dispatched[0].payload)).toMatchObject({ kind: 'entry_update', operations: { store: { source: 'repo', follow: 'branch' } } })
    expect(dispatched[0].change).toBe(result.moveChange)
    const move = await env.DB.prepare('SELECT class FROM changes WHERE id = ?').bind(result.moveChange).first<{ class: string }>()
    expect(move?.class).toBe('self_service')
    const zip = await call(`/api/changes/${result.change}/patch`, { cookie })
    expect(zip.headers.get('Content-Type')).toBe('application/zip')
    const text = new TextDecoder().decode(await zip.arrayBuffer())
    expect(text).toContain('plugin.store.json')
    expect(text).toContain('"Better."')
  })

  it('keeps translated permission notes in the store document', async () => {
    const cookie = await signedIn()
    const { doc } = await (await call(`/api/plugins/${ID}/store`, { cookie })).json() as { doc: Record<string, unknown> }
    const next = { ...doc, permission_reasons: { network: { en: 'Ignored.', ja_JP: 'アドレスの国を調べます。' }, unknown: { ja_JP: 'x' } } }
    await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: next, source: 'repo-branch' } })
    const state = await (await call(`/api/plugins/${ID}/store`, { cookie })).json() as { items: { field: string, label: string }[] }
    expect(state.items.filter(i => i.field === 'permission_reasons')).toEqual([
      { field: 'permission_reasons', locale: 'ja_JP', label: 'reason.ja_JP.network', review: false },
      { field: 'permission_reasons', locale: 'ja_JP', label: 'reason.ja_JP.unknown', review: false },
    ])
    const result = await (await call(`/api/plugins/${ID}/store/submit`, { method: 'POST', mutate: true, cookie, json: {} })).json() as { change: string }
    const zip = new TextDecoder().decode(await (await call(`/api/changes/${result.change}/patch`, { cookie })).arrayBuffer())
    expect(zip).toContain('"permission_reasons": {\n    "network": {\n      "ja_JP": "アドレスの国を調べます。"')
    expect(zip).not.toContain('Ignored.')
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

  it('takes a whole image of any shape that has room for a 16:10 part', async () => {
    const cookie = await signedIn()
    const upload = (bytes: Uint8Array) => call('/api/media?original=1', { method: 'POST', mutate: true, cookie, body: bytes, headers: { 'Content-Type': 'image/webp' } })
    expect((await upload(webp(2400, 1000))).status).toBe(201)
    expect((await upload(webp(1280, 1280))).status).toBe(201)
    // A 16:10 part of this one would be under 640 pixels wide.
    expect((await upload(webp(1600, 380))).status).toBe(422)
  })

  it('keeps the crop of a screenshot and counts a new crop as a new image', async () => {
    const cookie = await signedIn()
    const { doc } = await (await call(`/api/plugins/${ID}/store`, { cookie })).json() as { doc: { screenshots?: { id: string, path: string }[] } }
    const shots = [
      { id: 'wide', path: 'docs/wide.png', crop: { x: 0.123456, y: 0, width: 0.75, height: 1 } },
      { id: 'bad', path: 'docs/bad.png', crop: { x: 0.5, y: 0, width: 0.6, height: 1 } },
    ]
    const saved = await (await call(`/api/plugins/${ID}/store/draft`, { method: 'PUT', mutate: true, cookie, json: { doc: { ...doc, screenshots: shots }, source: 'repo-branch' } })).json() as { problems: string[] }
    expect(saved.problems).toEqual(['screenshots.bad: the crop is not a region inside the image'])
    const state = await (await call(`/api/plugins/${ID}/store`, { cookie })).json() as { draft: { doc: { screenshots: { id: string, crop?: unknown }[] } } }
    expect(state.draft.doc.screenshots.find(s => s.id === 'wide')?.crop).toEqual({ x: 0.1235, y: 0, width: 0.75, height: 1 })
  })
})
