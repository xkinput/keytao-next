import { describe, expect, it } from 'vitest'

import {
  buildPracticeDictionary,
  createPracticeItemsFromText,
  getCandidatesForCode,
  getCodesForText,
  hasTextCandidateForCode,
  parseRimeDictContent,
} from '@/lib/services/keytaoPracticeDictionary'

describe('keytaoPracticeDictionary', () => {
  it('parses Rime dictionary entries after the header marker', () => {
    const entries = parseRimeDictContent(`---
name: keytao.test
...
你\tni\t10
你好\tnihc\t20
# ignored
`, 'keytao.test.dict.yaml')

    expect(entries).toEqual([
      { text: '你', code: 'ni', weight: 10, source: 'keytao.test.dict.yaml' },
      { text: '你好', code: 'nihc', weight: 20, source: 'keytao.test.dict.yaml' },
    ])
  })

  it('indexes text codes and code candidates', () => {
    const dictionary = buildPracticeDictionary([
      { text: '你', code: 'ni', weight: 10, source: 'a' },
      { text: '你', code: 'nb', weight: 5, source: 'a' },
      { text: '你好', code: 'nihc', weight: 20, source: 'a' },
    ])

    expect(getCodesForText(dictionary, '你')).toEqual(['nb', 'ni'])
    expect(getCandidatesForCode(dictionary, 'ni').map((entry) => entry.text)).toEqual(['你', '你好'])
    expect(hasTextCandidateForCode(dictionary, '你好', 'ni', 'prefix')).toBe(true)
    expect(hasTextCandidateForCode(dictionary, '你好', 'ni')).toBe(false)
    expect(hasTextCandidateForCode(dictionary, '你好', 'nihc')).toBe(true)
  })

  it('creates longest-match practice items from uploaded text', () => {
    const dictionary = buildPracticeDictionary([
      { text: '键道', code: 'jmda', source: 'a' },
      { text: '键', code: 'jm', source: 'a' },
      { text: '练习', code: 'lmxi', source: 'a' },
    ])

    expect(createPracticeItemsFromText('键道练习', dictionary, 5)).toEqual([
      { text: '键道', codes: ['jmda'] },
      { text: '练习', codes: ['lmxi'] },
    ])
  })

  it('keeps an existing phrase target instead of splitting it into cheaper singles', () => {
    const dictionary = buildPracticeDictionary([
      { text: '夜色', code: 'yese', source: 'a' },
      { text: '夜', code: 'ye', source: 'a' },
      { text: '色', code: 'se', source: 'a' },
    ])

    expect(createPracticeItemsFromText('夜色', dictionary, 5)).toEqual([
      { text: '夜色', codes: ['yese'] },
    ])
  })
})
