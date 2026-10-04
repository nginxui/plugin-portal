import { describe, expect, it } from 'vitest'
import { packageAssets, parseCertificateSignature, parsePublicKey, reservedWord } from '../worker/lib/rules'
import { certificateSignature, publicKey } from './helpers'

describe('rules', () => {
  it('reads a minisign public key and its id', () => {
    expect(parsePublicKey(publicKey)).toEqual({ line: publicKey.split('\n')[1], id: '0102030405060708' })
    expect(parsePublicKey('not a key')).toBeNull()
    expect(parsePublicKey(btoa('short'))).toBeNull()
  })

  it('reads who signed a signer certificate and for which plugin', () => {
    expect(parseCertificateSignature(certificateSignature('io.x.y'))).toEqual({ primaryKeyId: '0102030405060708', pluginId: 'io.x.y' })
    expect(parseCertificateSignature('nonsense')).toBeNull()
  })

  it('finds reserved words as the catalog does', () => {
    expect(reservedWord('Official DNS')).toBe('official')
    expect(reservedWord('非官方 DNS')).toBe('')
    expect(reservedWord('De​mo')).toBe('an invisible character')
  })

  it('finds portable and per platform packages', () => {
    const assets = [{ name: 'io.x.y-1.0.0.tar.gz' }, { name: 'io.x.y-1.0.0-linux-amd64.tar.gz' }, { name: 'io.x.y-1.0.0.tar.gz.sha256' }]
    expect(packageAssets(assets, 'io.x.y', '1.0.0')).toEqual(['io.x.y-1.0.0.tar.gz', 'io.x.y-1.0.0-linux-amd64.tar.gz'])
  })
})
