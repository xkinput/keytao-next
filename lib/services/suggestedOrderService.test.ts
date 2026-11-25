import { describe, expect, it } from 'vitest'
import type { BatchAiReviewChainEntry } from '@/lib/types/batchAiReview'
import { compareChainEntry } from './batchAiReviewService'
import { parseMiaomiaoReviewRemark, rewriteMiaomiaoOrderRemark } from './miaomiaoReviewRemark'
import { planChainOrder } from './suggestedOrderService'

const current = (word: string, weight: number | null): BatchAiReviewChainEntry => ({
  word, weight, code: 'abcd', type: 'Phrase', source: 'current',
})
const draft = (word: string, weight: number | null, prId: number): BatchAiReviewChainEntry => ({
  ...current(word, weight), source: 'draft', prId, action: 'Create',
})

describe('planChainOrder', () => {
  it('keeps weights when the chain is already ordered', () => {
    expect(planChainOrder([current('甲', 110), draft('乙', 111, 1)], ['甲', '乙'])).toEqual({ updates: [] })
  })

  it('moves a draft ahead of a current phrase without changing the current weight', () => {
    const change = { ...draft('乙', 120, 1), action: 'Change' }
    expect(planChainOrder([current('甲', 110), change], ['乙', '甲']))
      .toEqual({ updates: [{ prId: 1, weight: 109 }] })
  })

  it('rejects a reversal of the fixed entries, including entries without a writable PR', () => {
    const unbound = { ...draft('乙', 111, 1), prId: undefined }
    expect(planChainOrder([current('甲', 110), unbound], ['乙', '甲']))
      .toEqual({ error: 'order_requires_current_phrase_change' })
  })

  it('rejects a draft between consecutive current weights', () => {
    expect(planChainOrder([current('甲', 110), current('乙', 111), draft('丙', 112, 1)], ['甲', '丙', '乙']))
      .toEqual({ error: 'no_weight_gap' })
  })

  it('reserves a deleted phrase’s weight even if the delete is part of the chain', () => {
    expect(planChainOrder([current('甲', 100), current('丙', 102), draft('新', 103, 1)], ['甲', '新', '丙'], [101]))
      .toEqual({ error: 'no_weight_gap' })
    expect(planChainOrder([current('甲', 100), current('丙', 103), draft('新', 104, 1)], ['甲', '新', '丙'], [102]))
      .toEqual({ updates: [{ prId: 1, weight: 101 }] })
  })

  it('reserves both original Change weights when swapping their replacements', () => {
    const replacements = [
      { ...draft('新甲', 101, 1), action: 'Change' },
      { ...draft('新乙', 102, 2), action: 'Change' },
    ]
    const order = ['前', '新乙', '新甲', '后']
    expect(planChainOrder([current('前', 100), ...replacements, current('后', 103)], order, [101, 102]))
      .toEqual({ error: 'no_weight_gap' })
    expect(planChainOrder([current('前', 100), ...replacements, current('后', 105)], order, [101, 102]))
      .toEqual({ updates: [{ prId: 2, weight: 103 }, { prId: 1, weight: 104 }] })
  })

  it('pins an interior null Create and leaves the trailing null Create unpinned', () => {
    const after = [current('甲', 105), draft('乙', 106, 1), draft('丙', 107, 2)]
    expect(planChainOrder(after, ['乙', '甲', '丙'], [], new Set([1, 2])))
      .toEqual({ updates: [{ prId: 1, weight: 104 }] })
    expect(planChainOrder(after, ['甲', '丙', '乙'], [], new Set([1, 2])))
      .toEqual({ error: 'no_weight_gap' })
    expect(planChainOrder(after, ['甲', '乙', '丙'], [], new Set([2])))
      .toEqual({ error: 'no_weight_gap' })
  })

  it('pins an interior null Create even when its projected weight already fits', () => {
    const after = [current('甲', 105), draft('乙', 106, 1), current('丙', 110), draft('丁', 120, 2)]
    expect(planChainOrder(after, ['丁', '甲', '乙', '丙'], [], new Set([1])))
      .toEqual({ updates: [{ prId: 2, weight: 104 }, { prId: 1, weight: 106 }] })
  })

  it('retains legacy weights and uses the valid weight range for new assignments', () => {
    expect(planChainOrder([current('甲', 90), draft('乙', 91, 1)], ['甲', '乙'])).toEqual({ updates: [] })
    expect(planChainOrder([current('甲', 100), draft('乙', 101, 1)], ['乙', '甲']))
      .toEqual({ error: 'no_weight_gap' })
  })

  it('assigns unique weights to ties and null drafts, keeping the longest fitting subsequence', () => {
    const after = [current('甲', 105), draft('乙', 109, 1), draft('丙', 107, 2),
      draft('丁', 108, 3), draft('戊', 108, 4), draft('己', null, 5)]
    const order = ['己', '甲', '乙', '丙', '丁', '戊']
    const result = planChainOrder(after, order)
    expect(result).toEqual({ updates: [{ prId: 5, weight: 100 }, { prId: 1, weight: 106 }, { prId: 4, weight: 109 }] })
    if ('error' in result) return
    const weights = new Map(result.updates.map(update => [update.prId, update.weight]))
    const rearranged = after.map(entry => ({ ...entry, weight: weights.get(entry.prId ?? 0) ?? entry.weight }))
      .sort(compareChainEntry)
    expect(rearranged.map(entry => entry.word)).toEqual(order)
    expect(new Set(rearranged.map(entry => entry.weight)).size).toBe(after.length)
  })

  it('fails closed on incomplete orders and on integer overflow', () => {
    expect(planChainOrder([draft('甲', 110, 1), draft('乙', 111, 2)], ['乙']))
      .toEqual({ error: 'order_requires_current_phrase_change' })
    expect(planChainOrder([current('甲', 2147483647), draft('乙', null, 1)], ['甲', '乙']))
      .toEqual({ error: 'no_weight_gap' })
  })
})

it('keeps a stale review stale when the new weight would match its old digest', () => {
  const slot = { code: 'abcd', type: 'Phrase' }
  const order = { ...slot, orderedWords: ['甲', '乙'], chainDigest: 'abababababababab' }
  const before = '0101010101010101'
  const after = '0202020202020202'
  const remark = [
    '排序：outside the review block',
    '--- miao-review:start ---',
    '本喵复审：通过',
    `排序：${JSON.stringify(order)}`,
    `校验：${after}`,
    '--- miao-review:end ---',
  ].join('\r\n')

  const rewritten = rewriteMiaomiaoOrderRemark(remark, slot, { before, after })
  expect(rewritten).toBe('排序：outside the review block\r\n--- miao-review:start ---\r\n本喵复审：通过\r\n--- miao-review:end ---')
  expect(parseMiaomiaoReviewRemark(rewritten).review?.reviewDigest).toBeUndefined()
})
