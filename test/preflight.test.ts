import { describe, expect, it } from 'vitest'
import { newer, preflightChecks, runtimeDiff, storeDiff } from '../worker/lib/preflight'
import { publicKey } from './helpers'

describe('preflight', () => {
  it('lists new permissions and hosts with the author notes', () => {
    const diff = runtimeDiff(
      { permissions: ['kv', 'files.write'], network_hosts: [], min_nginx_ui_version: '2.8.0', settings_schema: { properties: { db: { default: 'a' } } } },
      { permissions: ['kv', 'network'], network_hosts: ['api.ipinfo.io'], permission_reasons: { network: 'Looks up regions.' }, min_nginx_ui_version: '2.9.0', settings_schema: { properties: { db: { default: 'b' }, interval: { title: 'Interval' } } } },
    )
    expect(diff.permissions).toEqual([
      { sign: 'add', kind: 'permission', subject: 'network', note: 'Looks up regions.', attention: 'new' },
      { sign: 'del', kind: 'permission', subject: 'files.write' },
      { sign: 'add', kind: 'network_host', subject: 'api.ipinfo.io', note: undefined, attention: 'new' },
    ])
    expect(diff.compatibility.map(r => [r.sign, r.kind, r.subject])).toEqual([
      ['mod', 'min_nginx_ui_version', 'min_nginx_ui_version'],
      ['mod', 'setting_default', 'db'],
      ['add', 'setting', 'interval'],
    ])
  })

  it('marks names for review and descriptions that would be left out', () => {
    const rows = storeDiff(
      { name: { en: 'GeoIP' }, description: { en: 'Old' }, screenshots: [{ id: 'a', path: 'a.png' }] },
      { name: { en: 'GeoIP Access' }, description: { en: 'The official Nginx UI plugin.' }, screenshots: [{ id: 'b', path: 'b.png' }] },
    )
    expect(rows.map(r => [r.sign, r.kind, r.subject, r.attention])).toEqual([
      ['mod', 'name', 'en', 'review'],
      ['mod', 'description', 'en', 'left_out'],
      ['add', 'screenshot', 'b', undefined],
      ['del', 'screenshot', 'a', undefined],
    ])
  })

  it('checks the version and the signer certificate', () => {
    expect(newer('1.3.0', '1.2.0')).toBe(true)
    expect(newer('1.2.0-beta.1', '1.2.0')).toBe(false)
    expect(newer('1.2.0', '1.2.0-beta.1')).toBe(true)
    const checks = preflightChecks({ id: 'io.x.y', listedVersion: '1.2.0', manifest: { id: 'io.x.y', version: '1.1.0' }, primaryKey: publicKey, certificate: null, certificateSignature: null, images: [{ id: 'b', problem: 'size:3000000' }] })
    expect(checks.map(c => [c.key, c.status])).toEqual([['manifest', 'warn'], ['signer', 'warn'], ['screenshot', 'fail']])
  })
})
