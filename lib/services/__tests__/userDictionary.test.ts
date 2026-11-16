import { describe, expect, it } from 'vitest'
import { buildUserDictionaryYaml, normalizeUserDictionaryInput } from '@/lib/services/userDictionary'

describe('userDictionary', () => {
  it('normalizes entries and defaults to replacing public entries', () => {
    const input = normalizeUserDictionaryInput({ word: '键道', code: 'jmdc' })

    expect(input.word).toBe('键道')
    expect(input.code).toBe('jmdc')
    expect(input.type).toBe('Phrase')
    expect(input.replacePublic).toBe(true)
    expect(input.remove).toBe(false)
  })

  it.each([undefined, true, false])('disables replacement for removal markers with replacePublic=%s', replacePublic => {
    const input = normalizeUserDictionaryInput({ word: '键道', code: 'jmdc', remove: true, replacePublic })

    expect(input.remove).toBe(true)
    expect(input.replacePublic).toBe(false)
  })

  it.each([
    '--- miao-review:start ---',
    '--- miao-review:end ---',
  ])('rejects caller-supplied Miaomiao review delimiter %s', delimiter => {
    expect(() => normalizeUserDictionaryInput({
      word: '键道',
      code: 'jmdc',
      remark: `用户备注\n${delimiter}`,
    })).toThrow('备注不能包含喵喵复审块标记')
  })

  it('builds a Rime dictionary yaml', () => {
    const yaml = buildUserDictionaryYaml([
      { word: '键道', code: 'jmdc', weight: 100 },
    ], { name: 'keytao.user', version: '2026-07-05' })

    expect(yaml).toContain('name: keytao.user')
    expect(yaml).toContain('version: "2026-07-05"')
    expect(yaml).toContain('键道\tjmdc\t100')
  })

  it('skips removal markers without changing the remaining yaml', () => {
    const entry = { word: '键道', code: 'jmdc', weight: 100 }
    const options = { name: 'keytao.user', version: '2026-07-05' }

    const yaml = buildUserDictionaryYaml([
      { word: '原版词', code: 'ybci', weight: 100, remove: true },
      entry,
      { word: '保留词', code: 'blci', weight: 101, remove: false },
    ], options)

    expect(yaml).toBe(buildUserDictionaryYaml([
      entry,
      { word: '保留词', code: 'blci', weight: 101 },
    ], options))
    expect(yaml).not.toContain('原版词')
    expect(buildUserDictionaryYaml([{ ...entry, remove: true }], options))
      .toBe(buildUserDictionaryYaml([], options))
  })

  it('rejects an explicit weight below the selected type base', () => {
    expect(() => normalizeUserDictionaryInput({
      word: 'https://keytao.example',
      code: 'link',
      type: 'Link',
      weight: 9999,
    })).toThrow('链接的权重不能低于基础值 10000')
  })
})
