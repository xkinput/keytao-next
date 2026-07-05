import { describe, expect, it } from 'vitest'
import { buildUserDictionaryYaml, normalizeUserDictionaryInput } from '@/lib/services/userDictionary'

describe('userDictionary', () => {
  it('normalizes entries and defaults to replacing public entries', () => {
    const input = normalizeUserDictionaryInput({ word: '键道', code: 'jmdc' })

    expect(input.word).toBe('键道')
    expect(input.code).toBe('jmdc')
    expect(input.type).toBe('Phrase')
    expect(input.replacePublic).toBe(true)
  })

  it('builds a Rime dictionary yaml', () => {
    const yaml = buildUserDictionaryYaml([
      { word: '键道', code: 'jmdc', weight: 100 },
    ], { name: 'keytao.user', version: '2026-07-05' })

    expect(yaml).toContain('name: keytao.user')
    expect(yaml).toContain('version: "2026-07-05"')
    expect(yaml).toContain('键道\tjmdc\t100')
  })
})
