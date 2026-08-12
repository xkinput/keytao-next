import { describe, expect, it } from 'vitest'
import { parseReferenceDataFixture, toneNumbersToSymbols } from './referenceDataImport'

describe('reference data import fixtures', () => {
  it('normalizes tone-number readings, preserves multiple readings, and joins corpus frequency', () => {
    const imported = parseReferenceDataFixture({
      largePinyin: [
        '重行: chóng háng',
        '重行: zhòng xíng',
      ].join('\n'),
      zdicCibs: '重行: chóng háng',
      zdicCybs: '',
      cedict: [
        '重行 重行 [chong2 hang2] /to walk again/',
        '重行 重行 [zhong4 xing2] /repeated conduct/',
      ].join('\n'),
      jieba: [
        '重行 2718 v',
        '重行 3000 n',
      ].join('\n'),
    })

    expect(imported.byWord.get('重行')).toEqual({
      word: '重行',
      frequency: 3000,
      readings: [
        {
          reading: 'chóng háng',
          sources: ['large_pinyin', 'zdic_cibs', 'cedict'],
        },
        {
          reading: 'zhòng xíng',
          sources: ['large_pinyin', 'cedict'],
        },
      ],
    })
    expect(imported.frequencies).toEqual([{ word: '重行', frequency: 3000 }])
  })

  it('normalizes CEDICT umlaut notation and neutral tone numbers', () => {
    expect(toneNumbersToSymbols('lu:4 se5')).toBe('lǜ se')
  })
})
