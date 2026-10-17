import { afterEach, describe, expect, it } from 'vitest'
import { localeName } from '../worker/lib/localeNames'
import { HOST_LOCALES, isHostLocale, KNOWN_LOCALES, parseLinguas, refreshHostLocales, resetHostLocales } from '../worker/lib/locales'
import { call } from './helpers'

const env = { LINGUAS_URL: 'https://linguas.test/LINGUAS' }

afterEach(() => {
  resetHostLocales()
})

describe('languages of Nginx UI', () => {
  it('reads LINGUAS in the known order, new languages after them', () => {
    expect(parseLinguas('en zh_CN zh_TW fr_FR es de_DE ru_RU vi_VN ko_KR tr_TR ar uk_UA ja_JP pt_PT it_IT\n')).toEqual(KNOWN_LOCALES)
    expect(parseLinguas('pl_PL zh_CN en ../x')).toEqual(['en', 'zh_CN', 'pl_PL'])
    expect(parseLinguas('ja_JP')).toEqual(['en', 'ja_JP'])
  })

  it('follows a language Nginx UI adds, without a change here', async () => {
    expect(isHostLocale('pl_PL')).toBe(false)
    await refreshHostLocales(env, async () => new Response(`${KNOWN_LOCALES.join(' ')} pl_PL`))
    expect(isHostLocale('pl_PL')).toBe(true)
    expect(HOST_LOCALES.at(-1)).toBe('pl_PL')
    expect(localeName('pl_PL')).toBe('Polish')

    const response = await call('/api/locales')
    expect(await response.json()).toEqual({ locales: [...KNOWN_LOCALES, 'pl_PL'] })
  })

  it('keeps the list it has when LINGUAS cannot be read', async () => {
    await refreshHostLocales(env, async () => new Response('', { status: 503 }))
    expect(HOST_LOCALES).toEqual(KNOWN_LOCALES)
    // The next attempt waits, it does not run on every request.
    let calls = 0
    await refreshHostLocales(env, async () => {
      calls += 1
      return new Response('en pl_PL')
    })
    expect(calls).toBe(0)
  })

  it('names the known languages in English', () => {
    expect(KNOWN_LOCALES.map(localeName)).toEqual(['English', 'Simplified Chinese', 'Traditional Chinese', 'Japanese', 'Korean', 'German', 'French', 'Spanish', 'Italian', 'European Portuguese', 'Russian', 'Ukrainian', 'Turkish', 'Vietnamese', 'Arabic'])
  })
})
