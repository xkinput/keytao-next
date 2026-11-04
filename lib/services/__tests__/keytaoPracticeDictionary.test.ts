import { describe, expect, it } from 'vitest'

import {
  buildPracticeDictionary,
  createPracticeItemsFromText,
  getCandidatesForCode,
  getCodesForText,
  hasTextCandidateForCode,
  parseRimeDictContent,
  resolveSchemeDictionaryNames,
} from '@/lib/services/keytaoPracticeDictionary'

describe('keytaoPracticeDictionary', () => {
  it('resolves the translator dictionary and its import closure without reverse-lookup tables', () => {
    const names = resolveSchemeDictionaryNames(new Map([
      ['default.custom.yaml', '# - schema: ignored'],
      ['default.yaml', `schema_list:
  - schema: "xmjd6" # active
`],
      ['xmjd6.schema.yaml', `reverse_lookup:
  dictionary: liangfen
translator:
# Keep reading through comments and blank lines.

  dictionary: 'xmjd6' # active
pinyin_simp:
  dictionary: pinyin_simp
`],
      ['xmjd6.dict.yaml', `---
name: xmjd6
import_tables:
- xmjd6.danzi # column-zero item
# - xkjd6.ssb1

  - "xmjd6.cizu" # indented item
version: '1'
- after_list
...
`],
      ['xmjd6.danzi.dict.yaml', `import_tables:
  - xmjd6.nested
  - missing
...
`],
      ['xmjd6.nested.dict.yaml', '...'],
      ['xmjd6.cizu.dict.yaml', '...\nimport_tables:\n- after_header'],
      ['liangfen.dict.yaml', '...'],
      ['pinyin_simp.dict.yaml', '...'],
      ['xkjd6.ssb1.dict.yaml', '...'],
      ['after_list.dict.yaml', '...'],
      ['after_header.dict.yaml', '...'],
    ]))

    expect(names).toEqual(new Set(['xmjd6', 'xmjd6.danzi', 'xmjd6.nested', 'xmjd6.cizu']))
  })

  it('uses every custom-listed schema and dictionary patches while ignoring commented patches', () => {
    const names = resolveSchemeDictionaryNames(new Map([
      ['default.custom.yaml', `patch:
  schema_list:
    - schema: 'first' # active
- schema: second
# - schema: excluded
`],
      ['default.yaml', '- schema: fallback'],
      ['first.custom.yaml', `patch:
  # translator/dictionary: ignored
  translator/dictionary: "override" # active
`],
      ['first.schema.yaml', 'translator:\n  dictionary: original'],
      ['second.custom.yaml', '  # translator/dictionary: ignored'],
      ['second.schema.yaml', 'translator:\n  dictionary: second'],
      ['excluded.schema.yaml', 'translator:\n  dictionary: excluded'],
      ['fallback.schema.yaml', 'translator:\n  dictionary: fallback'],
      ['override.dict.yaml', '...'],
      ['original.dict.yaml', '...'],
      ['second.dict.yaml', '...'],
      ['excluded.dict.yaml', '...'],
      ['fallback.dict.yaml', '...'],
      ['ignored.dict.yaml', '...'],
    ]))

    expect(names).toEqual(new Set(['override', 'second']))
  })

  it('returns null without resolvable schemas or dictionaries and terminates import cycles', () => {
    expect(resolveSchemeDictionaryNames(new Map([
      ['default.custom.yaml', '# - schema: ignored'],
      ['default.yaml', '# - schema: ignored'],
      ['ignored.schema.yaml', 'translator:\n  dictionary: ignored'],
      ['ignored.dict.yaml', '...'],
    ]))).toBeNull()

    expect(resolveSchemeDictionaryNames(new Map([
      ['default.yaml', `schema_list:
  - schema: missing
  - schema: empty
  - schema: no_block
  - schema: no_dictionary
  - schema: missing_dictionary
  - schema: empty_patch
`],
      ['empty.schema.yaml', 'translator:\n  dictionary: ""\n  dictionary: ignored'],
      ['no_block.schema.yaml', 'reverse_lookup:\n  dictionary: ignored'],
      ['no_dictionary.schema.yaml', 'translator:\n  enable_sentence: true\nreverse_lookup:\n  dictionary: ignored'],
      ['missing_dictionary.schema.yaml', 'translator:\n  dictionary: absent'],
      ['empty_patch.custom.yaml', 'translator/dictionary: ""'],
      ['empty_patch.schema.yaml', 'translator:\n  dictionary: ignored'],
      ['ignored.dict.yaml', '...'],
    ]))).toBeNull()

    expect(resolveSchemeDictionaryNames(new Map([
      ['default.yaml', '- schema: cycle'],
      ['cycle.schema.yaml', 'translator:\n  dictionary: a'],
      ['a.dict.yaml', 'import_tables:\n- b\n...'],
      ['b.dict.yaml', 'import_tables:\n- a\n...'],
    ]))).toEqual(new Set(['a', 'b']))
  })

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
