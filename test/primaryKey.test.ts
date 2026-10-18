import type { Route } from './helpers'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, json, mockFetch, publicKey, signIn } from './helpers'

const ID = 'io.github.octo-author.geoip'
const currentLine = publicKey.split('\n')[1]
// Another key, id 0x1112131415161718.
const newKey = `untrusted comment: minisign public key 1112131415161718\n${btoa(String.fromCharCode(0x45, 0x64, 0x18, 0x17, 0x16, 0x15, 0x14, 0x13, 0x12, 0x11, ...Array.from({ length: 32 }, (_, i) => 255 - i)))}`

let dispatched: { change: string, payload: string }[] = []
let permissions = { admin: true, push: true, pull: true }

function routes(): Route[] {
  return [
    url => url.href === `${env.CATALOG_URL}/v1/index.json`
      ? json({ plugins: [{ id: ID, name: { en: 'GeoIP' }, repository_url: 'https://github.com/octo-author/geoip', author_public_key: currentLine, releases: [{ version: '1.0.0' }, { version: '1.1.0' }, { version: '0.9.0', yanked: true }] }] })
      : undefined,
    url => url.href === 'https://api.github.com/repos/octo-author/geoip'
      ? json({ id: 77, full_name: 'octo-author/geoip', owner: { id: 4242, login: 'octo-author', type: 'User', avatar_url: '' }, permissions })
      : undefined,
    url => url.pathname === `/repos/${env.CATALOG_REPO}/installation` ? json({ id: 9 }) : undefined,
    url => url.pathname === '/app/installations/9/access_tokens' ? json({ token: 'ghs' }) : undefined,
    async (url, init) => {
      if (url.pathname !== `/repos/${env.CATALOG_REPO}/actions/workflows/apply.yml/dispatches`)
        return undefined
      dispatched.push(JSON.parse(await new Response(init.body).text()).inputs)
      return new Response(null, { status: 204 })
    },
  ]
}

beforeEach(async () => {
  dispatched = []
  permissions = { admin: true, push: true, pull: true }
  await caches.default.delete(`${env.CATALOG_URL}/v1/index.json`)
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer)
  Object.assign(env, { DEPLOY_APP_ID: '1', DEPLOY_APP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` })
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

const send = (cookie: string, body: unknown) => call(`/api/plugins/${ID}/primary-key`, { method: 'POST', mutate: true, cookie, json: body })

describe('primary key replacement', () => {
  it('sends the new key with every listed version yanked, for review', async () => {
    const cookie = await signedIn()
    const response = await send(cookie, { public_key: newKey, reason: 'The disk with the key failed.' })
    expect(response.status).toBe(201)
    const payload = JSON.parse(dispatched[0].payload)
    expect(payload).toMatchObject({ kind: 'entry_update', plugin_id: ID, operations: { author_public_key: newKey.split('\n')[1], yank: ['1.0.0', '1.1.0'] }, reason: 'The disk with the key failed.' })
    expect(await env.DB.prepare(`SELECT kind, class FROM changes WHERE plugin_id = ?`).bind(ID).first()).toEqual({ kind: 'key', class: 'reviewed' })
    // One replacement at a time.
    expect((await send(cookie, { public_key: newKey, reason: 'Again.' })).status).toBe(409)
  })

  it('needs a valid new key, a reason and an admin', async () => {
    const cookie = await signedIn()
    expect((await send(cookie, { public_key: 'not a key', reason: 'x' })).status).toBe(422)
    expect((await send(cookie, { public_key: newKey, reason: ' ' })).status).toBe(422)
    expect((await send(cookie, { public_key: publicKey, reason: 'Same key.' })).status).toBe(409)
    permissions = { admin: false, push: true, pull: true }
    await env.DB.prepare('DELETE FROM repo_permissions').run()
    expect((await send(cookie, { public_key: newKey, reason: 'x' })).status).toBe(403)
    expect(dispatched).toEqual([])
  })
})
