import { describe, expect, it } from 'vitest'
import {
  containsControlCharacters,
  validatePhraseInput,
  assertValidPhraseInput,
  PhraseInputError,
} from '../phraseInput'
import {
  getCodeValidationError,
  getMaxCodeLength,
  isValidCode,
  MAX_CODE_LENGTH_ANY_TYPE,
} from '@/lib/constants/codeValidation'

describe('containsControlCharacters', () => {
  it.each([
    ['tab', 'a\tb'],
    ['newline', 'a\nb'],
    ['carriage return', 'a\rb'],
    ['null byte', 'a\u0000b'],
    ['delete', 'a\u007Fb'],
    ['line separator', 'a\u2028b'],
    ['paragraph separator', 'a\u2029b'],
  ])('detects %s', (_label, value) => {
    expect(containsControlCharacters(value)).toBe(true)
  })

  it('accepts ordinary text', () => {
    expect(containsControlCharacters('中国 keyboard ;a')).toBe(false)
  })
})

describe('per-type code limits', () => {
  it('keeps Chinese-side dictionaries at 6 characters', () => {
    for (const type of ['Single', 'Phrase', 'Supplement', 'CSS', 'CSSSingle'] as const) {
      expect(getMaxCodeLength(type)).toBe(6)
      expect(isValidCode('abcdef', type)).toBe(true)
      expect(isValidCode('abcdefg', type)).toBe(false)
    }
  })

  it('gives Symbol and Link more headroom', () => {
    expect(getMaxCodeLength('Symbol')).toBe(12)
    expect(getMaxCodeLength('Link')).toBe(12)
    expect(isValidCode(';abcdefg', 'Symbol')).toBe(true)
  })

  it('allows English codes up to the lookup limit', () => {
    expect(getMaxCodeLength('English')).toBe(MAX_CODE_LENGTH_ANY_TYPE)
    expect(isValidCode('internationally', 'English')).toBe(true)
  })

  it('falls back to the strict limit for unknown or missing types', () => {
    expect(getMaxCodeLength(undefined)).toBe(6)
    expect(getMaxCodeLength('NotAType')).toBe(6)
  })

  it('still rejects malformed codes regardless of type', () => {
    expect(getCodeValidationError('ab1', 'English')).toBe('编码格式错误')
    expect(getCodeValidationError('', 'Phrase')).toBe('编码不能为空')
  })
})

describe('validatePhraseInput', () => {
  const valid = { word: '中国', code: 'zgo', type: 'Phrase' as const }

  it('accepts a clean payload', () => {
    expect(validatePhraseInput(valid)).toBeNull()
  })

  it('rejects control characters in the word', () => {
    expect(validatePhraseInput({ ...valid, word: '中\t国' }))
      .toBe('词条不能包含制表符、换行符或其他控制字符')
  })

  it('rejects control characters in the code', () => {
    expect(validatePhraseInput({ ...valid, code: 'zg\no' }))
      .toBe('编码不能包含制表符、换行符或其他控制字符')
  })

  it('rejects control characters in the old word', () => {
    expect(validatePhraseInput({ ...valid, action: 'Change', oldWord: '旧\r词' }))
      .toBe('旧词不能包含制表符、换行符或其他控制字符')
  })

  it('enforces the per-type code length', () => {
    expect(validatePhraseInput({ ...valid, code: 'abcdefg' })).toBe('编码长度超过6个字符')
    expect(validatePhraseInput({ ...valid, code: 'abcdefg', type: 'English' })).toBeNull()
  })

  it('rejects unknown phrase types', () => {
    expect(validatePhraseInput({ ...valid, type: 'Nope' })).toBe('不支持的词库类型：Nope')
  })

  it('requires an old word for Change actions', () => {
    expect(validatePhraseInput({ ...valid, action: 'Change' })).toBe('修改操作需要指定旧词')
    expect(validatePhraseInput({ ...valid, action: 'Change', oldWord: '旧词' })).toBeNull()
  })

  it('enforces length limits', () => {
    expect(validatePhraseInput({ ...valid, word: '中'.repeat(101) })).toBe('词条最多 100 个字符')
    expect(validatePhraseInput({ ...valid, remark: 'x'.repeat(501) })).toBe('备注最多 500 个字符')
  })

  it('still allows multi-line remarks', () => {
    expect(validatePhraseInput({ ...valid, remark: '喵喵审词：\n读音 zhong guo' })).toBeNull()
  })

  it('rejects non-string word or code', () => {
    expect(validatePhraseInput({ word: 123, code: 'abc' })).toBe('词条和编码必须是字符串')
  })
})

describe('assertValidPhraseInput', () => {
  it('throws PhraseInputError with the label prefix', () => {
    expect(() => assertValidPhraseInput({ word: '中\t国', code: 'zgo' }, '第 1 项：'))
      .toThrow(PhraseInputError)
    expect(() => assertValidPhraseInput({ word: '中\t国', code: 'zgo' }, '第 1 项：'))
      .toThrow(/^第 1 项：/)
  })

  it('does not throw for a clean payload', () => {
    expect(() => assertValidPhraseInput({ word: '中国', code: 'zgo', type: 'Phrase' })).not.toThrow()
  })
})
