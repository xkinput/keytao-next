import { describe, expect, it } from 'vitest'
import type { BatchConflictResult, BatchPRItem } from '../batchConflictService'
import { buildBatchSubmitWarnings, formatBatchSubmitWarnings } from '../batchSubmitWarnings'

describe('buildBatchSubmitWarnings', () => {
  it('does not warn for moving a word by deleting its old code and creating a new code', () => {
    const items: BatchPRItem[] = [
      { id: '1', action: 'Delete', word: '中联航', code: 'xlhiv', type: 'Phrase' },
      { id: '2', action: 'Create', word: '中联航', code: 'flhi', type: 'Phrase', weight: 100 },
    ]
    const results: BatchConflictResult[] = [
      {
        id: '1',
        conflict: {
          hasConflict: false,
          code: 'xlhiv',
          currentPhrase: { id: 1, userId: 1, word: '中联航', code: 'xlhiv', weight: 100 },
          impact: '编码 xlhiv 存在重码（权重: 100）',
          suggestions: [],
        },
      },
      {
        id: '2',
        conflict: {
          hasConflict: false,
          code: 'flhi',
          suggestions: [],
        },
      },
    ]

    expect(buildBatchSubmitWarnings(items, results)).toEqual([])
  })

  it('warns for a standalone create that would add a duplicate code', () => {
    const items: BatchPRItem[] = [
      { id: '1', action: 'Create', word: '新词', code: 'flhi', type: 'Phrase', weight: 101 },
    ]
    const results: BatchConflictResult[] = [
      {
        id: '1',
        conflict: {
          hasConflict: false,
          code: 'flhi',
          currentPhrase: { id: 1, userId: 1, word: '中联航', code: 'flhi', weight: 100 },
          impact: '编码 "flhi" 已被词条 "中联航" 占用，将创建重码（建议权重: 101）',
          suggestions: [],
        },
      },
    ]

    expect(buildBatchSubmitWarnings(items, results)).toEqual([
      {
        id: '1',
        word: '中联航',
        code: 'flhi',
        weight: 100,
        impact: '编码 "flhi" 已被词条 "中联航" 占用，将创建重码（建议权重: 101）',
      },
    ])
  })

  it('formats warnings with item position and requested phrase', () => {
    const items: BatchPRItem[] = [
      { id: '1', action: 'Create', word: '新词', code: 'flhi', type: 'Phrase', weight: 101 },
    ]
    const warnings = [{
      id: '1',
      word: '中联航',
      code: 'flhi',
      weight: 100,
      impact: '编码 "flhi" 已被词条 "中联航" 占用，将创建重码（建议权重: 101）',
    }]

    expect(formatBatchSubmitWarnings(warnings, items)).toEqual([
      '▶ 项目 #1 - 创建重码/多编码警告:\n' +
      '   请求词条: 新词 @ flhi\n' +
      '   编码 "flhi" 已被词条 "中联航" 占用，将创建重码（建议权重: 101）\n' +
      '   ! 确认后将按批次净效果提交。',
    ])
  })
})
