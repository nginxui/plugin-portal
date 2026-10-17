import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { daily, mail, remind, syncPulls } from '../worker/jobs'
import { call, githubUser, json, mockFetch, signIn } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

async function seed(state = 'open', waiting = 'author', updated = Math.floor(Date.now() / 1000) - 20 * 3600) {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, waiting_on, created_at, updated_at) VALUES ('c_track0000001', 'io.x.y', ?, 'names', 'reviewed', ?, 'review', ?, ?, ?)`).bind(githubUser.id, state, waiting, updated, updated),
    env.DB.prepare(`INSERT INTO change_events (change_id, stage, actor_id, at) VALUES ('c_track0000001', 'changes_requested', NULL, ?)`).bind(updated),
  ])
}

describe('tracker', () => {
  it('lets the author withdraw an open change', async () => {
    const cookie = await signIn()
    vi.restoreAllMocks()
    await seed('open', 'maintainer')
    expect((await call('/api/changes/c_track0000001/withdraw', { method: 'POST', mutate: true, cookie })).status).toBe(200)
    expect(await env.DB.prepare(`SELECT state FROM changes WHERE id = 'c_track0000001'`).first()).toEqual({ state: 'withdrawn' })
    expect((await call('/api/changes/c_track0000001/withdraw', { method: 'POST', mutate: true, cookie })).status).toBe(409)
  })

  it('tells an open page where a change stands without calling GitHub', async () => {
    const cookie = await signIn()
    vi.restoreAllMocks()
    await seed('open', 'maintainer', 1000)
    const fetchSpy = mockFetch()
    const response = await call('/api/changes/c_track0000001/state', { cookie })
    expect(await response.json()).toEqual({ state: 'open', stage: 'review', updatedAt: 1000 })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await call('/api/changes/c_missing000001/state', { cookie })).status).toBe(404)
  })

  it('removes audit records past a year and reads the glossary once a day', async () => {
    const t = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO audit (actor_id, action, at) VALUES (NULL, 'old', ?)`).bind(t - 400 * 86400),
      env.DB.prepare(`INSERT INTO audit (actor_id, action, at) VALUES (NULL, 'recent', ?)`).bind(t - 10 * 86400),
    ])
    mockFetch(url => url.pathname.endsWith('.po') ? new Response('msgid "Site"\nmsgstr "サイト"\n') : undefined)
    expect(await daily(env)).toBe(true)
    expect((await env.DB.prepare(`SELECT action FROM audit WHERE action IN ('old', 'recent')`).all()).results).toEqual([{ action: 'recent' }])
    expect(Number((await env.DB.prepare(`SELECT value FROM job_state WHERE name = 'glossary.locales'`).first<{ value: string }>())?.value)).toBeGreaterThan(0)
    expect(await daily(env)).toBe(false)
  })

  it('follows pull requests merged or closed on GitHub', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer)
    Object.assign(env, { DEPLOY_APP_ID: '1', DEPLOY_APP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` })
    const t = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO changes (id, author_id, kind, class, state, stage, waiting_on, pr_number, created_at, updated_at) VALUES ('c_sync00000001', ?, 'partner', 'maintainer', 'open', 'review', 'maintainer', 31, ?, ?)`).bind(githubUser.id, t, t),
      env.DB.prepare(`INSERT INTO changes (id, author_id, kind, class, state, stage, waiting_on, pr_number, created_at, updated_at) VALUES ('c_sync00000002', ?, 'partner', 'maintainer', 'open', 'review', 'maintainer', 32, ?, ?)`).bind(githubUser.id, t, t),
      env.DB.prepare(`INSERT INTO changes (id, author_id, kind, class, state, stage, waiting_on, pr_number, created_at, updated_at) VALUES ('c_sync00000003', ?, 'partner', 'maintainer', 'open', 'review', 'maintainer', 33, ?, ?)`).bind(githubUser.id, t, t),
    ])
    const pulls: Record<string, unknown> = {
      31: { state: 'closed', merged: false, head: { ref: 'portal/c_sync00000001' } },
      32: { state: 'closed', merged: true, merge_commit_sha: 'abc123', head: { ref: 'portal/c_sync00000002' } },
      33: { state: 'open', merged: false, head: { ref: 'portal/c_sync00000003' } },
    }
    mockFetch(
      url => url.pathname === `/repos/${env.CATALOG_REPO}/installation` ? json({ id: 9 }) : undefined,
      url => url.pathname === '/app/installations/9/access_tokens' ? json({ token: 'ghs' }) : undefined,
      url => url.pathname.endsWith('/issues/31/comments') ? json([{ body: 'Superseded by a newer key.' }]) : undefined,
      (url, init) => init.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined,
      (url) => {
        const number = url.pathname.match(/\/pulls\/(\d+)$/)?.[1]
        return number ? json(pulls[number]) : undefined
      },
    )
    expect(await syncPulls(env)).toBe(2)
    const rows = (await env.DB.prepare(`SELECT id, state FROM changes WHERE id LIKE 'c_sync%' ORDER BY id`).all()).results
    expect(rows).toEqual([
      { id: 'c_sync00000001', state: 'rejected' },
      { id: 'c_sync00000002', state: 'merged' },
      { id: 'c_sync00000003', state: 'open' },
    ])
    expect(await env.DB.prepare(`SELECT detail_json FROM change_events WHERE change_id = 'c_sync00000001' AND stage = 'rejected'`).first()).toEqual({ detail_json: JSON.stringify({ comment: 'Superseded by a newer key.' }) })
  })

  it('reminds once after 18 hours of waiting on the author', async () => {
    await seed()
    expect(await remind(env)).toBe(1)
    expect(await remind(env)).toBe(0)
  })

  it('takes no address while the portal may not read the GitHub addresses', async () => {
    const cookie = await signIn()
    vi.restoreAllMocks()
    mockFetch(url => url.href === 'https://api.github.com/user/emails' ? json({ message: 'Resource not accessible by integration' }, 403) : undefined)
    expect(await (await call('/api/notifications/prefs', { cookie })).json()).toMatchObject({ emails: null })
    const refused = await call('/api/notifications/prefs', { method: 'PUT', mutate: true, cookie, json: { inApp: true, emailOnLive: true, email: 'someone@example.com' } })
    expect(await refused.json()).toEqual({ error: 'no_email_access' })
  })

  it('notifies of events by others and mails who asked for it', async () => {
    const cookie = await signIn()
    vi.restoreAllMocks()
    await seed()
    const list = await (await call('/api/notifications', { cookie })).json() as { items: { stage: string, changeState: string, waitingOn: string | null }[], unread: number, inApp: boolean }
    expect(list.items.map(i => i.stage)).toEqual(['changes_requested'])
    // Where the change stands now tells the list whether it waits for the user.
    expect(list.items[0]).toMatchObject({ changeState: 'open', waitingOn: 'author' })
    expect(list.inApp).toBe(true)
    expect(list.unread).toBe(1)
    await call('/api/notifications/read', { method: 'POST', mutate: true, cookie })
    expect(((await (await call('/api/notifications', { cookie })).json()) as { unread: number }).unread).toBe(0)

    // Clearing keeps what waits for the user and drops the rest; progress of
    // a change that ended a month ago is gone by itself.
    const t = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, created_at, updated_at) VALUES ('c_done000000001', 'io.x.y', ?, 'names', 'reviewed', 'live', 'live', ?, ?)`).bind(githubUser.id, t - 60, t - 60),
      env.DB.prepare(`INSERT INTO change_events (change_id, stage, actor_id, at) VALUES ('c_done000000001', 'live', NULL, ?)`).bind(t - 60),
      env.DB.prepare(`INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, created_at, updated_at) VALUES ('c_old0000000001', 'io.x.y', ?, 'names', 'reviewed', 'live', 'live', ?, ?)`).bind(githubUser.id, t - 40 * 86400, t - 40 * 86400),
      env.DB.prepare(`INSERT INTO change_events (change_id, stage, actor_id, at) VALUES ('c_old0000000001', 'live', NULL, ?)`).bind(t - 40 * 86400),
    ])
    const stages = async () => ((await (await call('/api/notifications', { cookie })).json()) as { items: { stage: string }[] }).items.map(i => i.stage)
    expect(await stages()).toEqual(['live', 'changes_requested'])
    expect((await call('/api/notifications/clear', { method: 'POST', mutate: true, cookie })).status).toBe(200)
    expect(await stages()).toEqual(['changes_requested'])

    // Only an address verified on the GitHub account is taken.
    mockFetch(url => url.href === 'https://api.github.com/user/emails'
      ? json([{ email: 'octo@example.com', primary: true, verified: true }, { email: 'other@example.com', primary: false, verified: false }, { email: '1+octo@users.noreply.github.com', primary: false, verified: true }])
      : undefined)
    const prefs = await (await call('/api/notifications/prefs', { cookie })).json() as { emails: { email: string }[] }
    expect(prefs.emails.map(e => e.email)).toEqual(['octo@example.com'])
    const refused = await call('/api/notifications/prefs', { method: 'PUT', mutate: true, cookie, json: { inApp: true, emailOnAction: true, email: 'other@example.com' } })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toEqual({ error: 'unverified_email' })
    await call('/api/notifications/prefs', { method: 'PUT', mutate: true, cookie, json: { inApp: true, emailOnAction: true, email: 'octo@example.com' } })
    vi.restoreAllMocks()
    Object.assign(env, { EMAIL_API_URL: 'https://mail.example/send', EMAIL_API_KEY: 'k', EMAIL_FROM: 'portal@nginxui.com' })
    const sent: unknown[] = []
    mockFetch(async (url, init) => {
      if (url.href !== 'https://mail.example/send')
        return undefined
      sent.push(JSON.parse(await new Response(init.body).text()))
      return json({ id: 'm1' })
    })
    expect(await mail(env)).toBe(1)
    // The sender is named in the language of the mail, the change by its kind.
    expect(sent[0]).toMatchObject({ to: 'octo@example.com', from: '"Nginx UI Developer Center" <portal@nginxui.com>', subject: 'A maintainer asked for changes to your name change to io.x.y' })
    expect(await mail(env)).toBe(0)

    // Checks that found problems wait for the author; checks that could not
    // run wait for a maintainer and send nothing.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO change_events (change_id, stage, actor_id, detail_json, at) VALUES ('c_track0000001', 'checks', NULL, '{"outcome":"error"}', ?)`).bind(t),
      env.DB.prepare(`INSERT INTO change_events (change_id, stage, actor_id, detail_json, at) VALUES ('c_track0000001', 'checks', NULL, '{"outcome":"checks_failed"}', ?)`).bind(t),
    ])
    expect(await mail(env)).toBe(1)
    expect((sent[1] as { subject: string, text: string }).subject).toBe('The checks found problems in your name change to io.x.y')
    expect((sent[1] as { text: string }).text).toContain('/changes/')

    // Mail comes in the language the user picked, with the plugin's name in it.
    expect((await call('/api/me/locale', { method: 'PUT', mutate: true, cookie, json: { locale: 'fr_FR' } })).status).toBe(422)
    expect((await call('/api/me/locale', { method: 'PUT', mutate: true, cookie, json: { locale: 'zh_CN' } })).status).toBe(200)
    await env.DB.batch([
      env.DB.prepare(`UPDATE changes SET number = 12, entry_json = '{"name":{"en":"Uptime Probe","zh_CN":"可用性探针"}}' WHERE id = 'c_track0000001'`),
      env.DB.prepare(`INSERT INTO change_events (change_id, stage, actor_id, detail_json, at) VALUES ('c_track0000001', 'rejected', NULL, '{"comment":"Copies <b>another</b> plugin"}', ?)`).bind(t),
    ])
    expect(await mail(env)).toBe(1)
    const rejected = sent[2] as { subject: string, text: string, html: string }
    expect(rejected.subject).toBe('“可用性探针”的名称变更 #12 已被拒绝')
    expect(rejected).toMatchObject({ from: '"Nginx UI 开发者中心" <portal@nginxui.com>' })
    expect(rejected.text).toContain('拒绝原因')
    expect(rejected.html).toContain('prefers-color-scheme: dark')
    // The HTML form carries the maintainer's words escaped, and a button to the change.
    expect(rejected.text).toContain('Copies <b>another</b> plugin')
    expect(rejected.html).toContain('Copies &lt;b&gt;another&lt;/b&gt; plugin')
    expect(rejected.html).toMatch(/<a href="[^"]+\/changes\/[^"]+"[^>]*>查看更改<\/a>/)
    expect(rejected.html).toContain(`${env.PORTAL_ORIGIN}/mail-logo.png`)
  })
})
