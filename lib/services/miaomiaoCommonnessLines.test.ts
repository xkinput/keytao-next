import { describe, expect, it, vi } from 'vitest'
import type { BatchAiReviewItem } from '@/lib/types/batchAiReview'
import { buildBatchAiReviewItems, computeChainDigest } from './batchAiReviewService'
import { formatMiaomiaoReviewRemark } from './batchBotReviewService'
import {
  MIAOMIAO_REVIEW_BLOCK_END,
  MIAOMIAO_REVIEW_BLOCK_START,
  parseMiaomiaoReviewRemark,
} from './miaomiaoReviewRemark'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pronunciationReference: { findMany: vi.fn().mockResolvedValue([]) },
    corpusFrequency: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const generatedAt = '2026-11-25T00:00:00.000Z'
const suggestedOrder = { code: 'xyzt', type: 'Phrase', orderedWords: ['中', '阿'], chainDigest: 'dc19f5ffbffdbd2c' }
const item: BatchAiReviewItem = {
  prId: 1,
  status: 'attention',
  severity: 'warning',
  title: '需要复核',
  reasons: [],
  suggestions: [],
  reviewRecord: {
    reviewedBy: 'Miaomiao',
    source: 'bot-llm',
    summary: '需要复核',
    commonness: { daily: '常见\n来源：现代汉语词典', authority: '离线词典已收录' },
    sources: [],
    evidence: [],
  },
  suggestedOrder,
}
const row = { id: 1, action: 'Create', word: '中', code: 'xyzt', weight: 10, _count: { likedBy: 0, dislikedBy: 0 } }

function reviewBlock(...lines: string[]): string {
  return [MIAOMIAO_REVIEW_BLOCK_START, ...lines, MIAOMIAO_REVIEW_BLOCK_END].join('\n')
}

describe('persisted Miaomiao commonness and order', () => {
  it('round-trips commonness and suggested order in their own fields', async () => {
    const reviewDigest = '0123456789abcdef'
    const remark = formatMiaomiaoReviewRemark(item, generatedAt, reviewDigest)
    expect(remark.split('\n').slice(-6)).toEqual([
      '常用：常见 来源：现代汉语词典',
      '收录：离线词典已收录',
      `排序：${JSON.stringify(suggestedOrder)}`,
      `时间：${generatedAt}`,
      `校验：${reviewDigest}`,
      MIAOMIAO_REVIEW_BLOCK_END,
    ])
    const commonness = { daily: '常见 来源：现代汉语词典', authority: '离线词典已收录' }
    expect(parseMiaomiaoReviewRemark(remark).review).toMatchObject({ commonness, suggestedOrder, sources: [], evidence: [] })
    const [result] = await buildBatchAiReviewItems([{ ...row, remark }], false)
    expect(result).toMatchObject({
      suggestedOrder,
      reviewRecord: { commonness, sources: [], authoritySources: [], evidence: ['本喵已调用 LLM 完成复审。'] },
    })
  })

  it('keeps a review containing only commonness at attention', async () => {
    const remark = reviewBlock('常用：日常高频', '收录：现代汉语词典已收录')
    const [result] = await buildBatchAiReviewItems([{ ...row, remark }], false)
    expect(result).toMatchObject({
      status: 'attention',
      tier: 'look',
      reviewRecord: {
        commonness: { daily: '日常高频', authority: '现代汉语词典已收录' },
        sources: [],
        authoritySources: [],
        commonSenseSources: [],
      },
    })
  })

  it.each(['\n', '\u2028'])('keeps commonness out of adjacent empty fields (%j)', (separator) => {
    const remark = reviewBlock(['来源：', '收录：现代汉语词典已收录', '证据：', '常用：日常高频'].join(separator))
    expect(parseMiaomiaoReviewRemark(remark).review).toMatchObject({
      commonness: { daily: '日常高频', authority: '现代汉语词典已收录' },
      sources: [],
      evidence: [],
    })
  })

  it.each([
    { code: 42 },
    { type: null },
    { orderedWords: ['中'] },
    { orderedWords: [...'一二三四五六七八九'] },
    { orderedWords: ['中', '中'] },
    { orderedWords: ['中', ''] },
    { orderedWords: ['中', '阿\n字'] },
    { orderedWords: ['中', '阿\u2028字'] },
    { orderedWords: ['中', 42] },
    { chainDigest: 'DC19F5FFBFFDBD2C' },
  ])('drops invalid suggested order %j on write and read', (patch) => {
    const invalidOrder = { ...suggestedOrder, ...patch }
    const remark = formatMiaomiaoReviewRemark({
      ...item, suggestedOrder: invalidOrder as BatchAiReviewItem['suggestedOrder'],
    }, generatedAt)
    expect(remark).not.toContain('\n排序：')
    const parsed = parseMiaomiaoReviewRemark(reviewBlock(`排序：${JSON.stringify(invalidOrder)}`, `时间：${generatedAt}`))
    expect(parsed.review).toMatchObject({ generatedAt })
    expect(parsed.review?.suggestedOrder).toBeUndefined()
  })

  it('ignores malformed JSON and still parses the remaining fields', () => {
    const { review } = parseMiaomiaoReviewRemark(reviewBlock('排序：{', '常用：日常高频'))
    expect(review?.suggestedOrder).toBeUndefined()
    expect(review?.commonness?.daily).toBe('日常高频')
  })

  it('round-trips remark delimiters and Unicode separators inside valid order values', () => {
    const order = { ...suggestedOrder, type: 'Phrase\u2028', orderedWords: [MIAOMIAO_REVIEW_BLOCK_END, '阿'] }
    const remark = formatMiaomiaoReviewRemark({ ...item, suggestedOrder: order }, generatedAt)
    expect(parseMiaomiaoReviewRemark(remark)).toMatchObject({ baseRemark: '', review: { suggestedOrder: order, generatedAt } })
  })
})

describe('computeChainDigest', () => {
  it.each([
    {
      entries: [
        { word: '天', code: 'ABCD', type: 'Phrase', weight: 20 },
        { word: '地', code: 'ABCD', type: 'Phrase', weight: 3 },
      ],
      digest: '83e888cfb2c7460c',
    },
    {
      entries: [
        { word: '阿', code: 'xyzt', type: 'Phrase', weight: 10 },
        { word: '中国', code: 'xyzt', type: 'Phrase', weight: 10 },
        { word: '中', code: 'xyzt', type: 'Phrase', weight: 10 },
      ],
      digest: 'dc19f5ffbffdbd2c',
    },
    {
      entries: [
        { word: '一', code: 'extb', type: '', weight: null },
        { word: '𠀀', code: 'extb', type: '', weight: 0 },
        { word: '兀', code: 'extb', type: '', weight: 0 },
      ],
      digest: 'b51cd8e1b5e45587',
    },
  ])('matches the fixed digest $digest in either input order', ({ entries, digest }) => {
    expect(computeChainDigest(entries)).toBe(digest)
    expect(computeChainDigest([...entries].reverse())).toBe(digest)
  })
})
