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

  it('formats skipped candidate slot warnings', () => {
    const items: BatchPRItem[] = [
      { id: '1', action: 'Create', word: '跳码词', code: 'fmzlai', type: 'Phrase', weight: 100 },
    ]
    const warnings = [{
      id: '1',
      word: '跳码词',
      code: 'fmzlai',
      weight: 100,
      warningType: 'skipped_candidate_slot' as const,
      skippedCode: 'fmzla',
      skippedCodes: ['fmzla'],
      impact: '编码链中更短候选 "fmzla" 仍是空位，你正在跳过它直接把「跳码词」加到更长编码 "fmzlai"。',
    }]

    expect(formatBatchSubmitWarnings(warnings, items)).toEqual([
      '▶ 项目 #1 - 跳过编码空位警告:\n' +
      '   请求词条: 跳码词 @ fmzlai\n' +
      '   编码链中更短候选 "fmzla" 仍是空位，你正在跳过它直接把「跳码词」加到更长编码 "fmzlai"。\n' +
      '   ! 请确认是否要跳过编码 fmzla 直接继续。',
    ])
  })

  it('formats code chain priority warnings', () => {
    const items: BatchPRItem[] = [
      { id: '1', action: 'Change', word: '大盘鸡', oldWord: '单片机', code: 'dpj', type: 'Phrase', weight: 100 },
    ]
    const warnings = [{
      id: '1',
      word: '大盘鸡',
      code: 'dpj',
      weight: 100,
      warningType: 'code_chain_priority' as const,
      comparedWord: '单片机',
      impact: '提交后「大盘鸡」会排在「单片机」前；请确认这符合日常使用优先级。',
    }]

    expect(formatBatchSubmitWarnings(warnings, items)).toEqual([
      '▶ 项目 #1 - 同码链优先级确认:\n' +
      '   请求词条: 大盘鸡 @ dpj\n' +
      '   提交后「大盘鸡」会排在「单片机」前；请确认这符合日常使用优先级。\n' +
      '   ! 确认后才会提交审核。',
    ])
  })
})
