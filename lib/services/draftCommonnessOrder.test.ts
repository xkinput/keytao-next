import { describe, expect, it } from 'vitest'
import {
  buildDraftOrderChains, getDraftCodeFills, groupDraftOrderItems, planDraftOrderWeights,
  type DraftOrderItem,
} from './draftCommonnessOrder'
import { draftOrderKey, type CommonnessOrderResult } from '@/lib/types/commonnessOrder'

function item(fieldId: string, word: string, overrides: Partial<DraftOrderItem> = {}): DraftOrderItem {
  return { fieldId, word, code: 'abcd', type: 'Phrase', action: 'Create', oldWord: '', weight: '', ...overrides }
}

function prepare(rows: DraftOrderItem[], live: Array<{ word: string; weight: number }>) {
  return buildDraftOrderChains(groupDraftOrderItems(rows), new Map([[draftOrderKey('abcd', 'Phrase'), live]]))
}

describe('draft commonness chains', () => {
  it('includes live anchors and draft rows within the same code and type, and skips Delete rows', () => {
    const slots = groupDraftOrderItems([
      item('new', '草稿'), item('saved', '已有草稿', { prId: 42, weight: '112' }),
      item('delete', '待删', { action: 'Delete' }),
      item('single', '字', { type: 'Single' }), item('empty', '待填', { code: '' }),
    ])
    const chains = buildDraftOrderChains(slots, new Map([
      [draftOrderKey('abcd', 'Phrase'), [{ word: '在用', weight: 110 }]],
    ]))
    expect(chains.map(chain => chain.request)).toEqual([{
      code: 'abcd', type: 'Phrase', entries: [
        { word: '在用', weight: 110, source: 'current' },
        { word: '草稿', weight: null, source: 'draft' },
        { word: '已有草稿', weight: 112, source: 'draft', prId: 42 },
      ],
    }])
  })

  it('uses a Change draft in place of its live target and keeps its original weight reserved', () => {
    const [chain] = prepare([item('edit', '新词', { action: 'Change', oldWord: '旧词', weight: '110' })], [
      { word: '旧词', weight: 110 }, { word: '固定', weight: 112 },
    ])
    expect(chain.request.entries.map(entry => entry.word)).toEqual(['固定', '新词'])
    expect(planDraftOrderWeights(chain, { code: 'abcd', type: 'Phrase', status: 'reorder', orderedWords: ['新词', '固定'] }))
      .toEqual([{ fieldId: 'edit', weight: '111' }])
  })

  it('skips unknown occupancy, single entries, oversized chains and incompatible words', () => {
    const drafts = [item('draft', '草稿')]
    expect(buildDraftOrderChains(groupDraftOrderItems(drafts), new Map())).toEqual([])
    expect(prepare(drafts, [])).toEqual([])
    expect(prepare(drafts, Array.from({ length: 7 }, (_, i) => ({ word: `占位${i}`, weight: 110 + i })))).toHaveLength(1)
    expect(prepare(drafts, Array.from({ length: 8 }, (_, i) => ({ word: `占位${i}`, weight: 110 + i })))).toEqual([])
    expect(prepare(drafts, [{ word: '词'.repeat(31), weight: 110 }])).toEqual([])
  })

  it('caps request chains and counts distinct words across them', () => {
    const rows: DraftOrderItem[] = []
    const liveBySlot = new Map<string, Array<{ word: string; weight: number }>>()
    for (const suffix of 'abcdefghijklmnopqrstu') {
      const code = `abc${suffix}`
      rows.push(item(code, '共用', { code }))
      liveBySlot.set(draftOrderKey(code, 'Phrase'), [{ word: '在用', weight: 110 }])
    }
    expect(buildDraftOrderChains(groupDraftOrderItems(rows), liveBySlot)).toHaveLength(20)
    for (const row of rows) {
      liveBySlot.set(draftOrderKey(row.code, 'Phrase'), Array.from({ length: 7 }, (_, i) => ({
        word: `${row.code}${i}`, weight: 110 + i,
      })))
    }
    const chains = buildDraftOrderChains(groupDraftOrderItems(rows), liveBySlot)
    expect(chains).toHaveLength(17)
    expect(new Set(chains.flatMap(chain => chain.request.entries.map(entry => entry.word))).size).toBe(120)
  })
})

describe('draft form updates', () => {
  it('skips a weight occupied by a non-Finish phrase outside the live chain', () => {
    const [chain] = prepare([item('draft', '草稿')], [{ word: '在用', weight: 100 }])
    const result: CommonnessOrderResult = { code: 'abcd', type: 'Phrase', status: 'reorder', orderedWords: ['在用', '草稿'] }
    expect(planDraftOrderWeights(chain, result, [100, 101]))
      .toEqual([{ fieldId: 'draft', weight: '102' }])
  })

  it('applies planner weights only to draft fields and observes the type floor', () => {
    const [chain] = prepare([item('draft', '草稿', { weight: '1e2' })], [{ word: '在用', weight: 110 }])
    expect(planDraftOrderWeights(chain, { code: 'abcd', type: 'Phrase', status: 'reorder', orderedWords: ['草稿', '在用'] }))
      .toEqual([{ fieldId: 'draft', weight: '100' }])
    expect(chain.entries[0].weight).toBe(110)
    const [withBlankWeight] = prepare([item('draft', '草稿')], [{ word: '在用', weight: 110 }])
    expect(planDraftOrderWeights(withBlankWeight, { code: 'abcd', type: 'Phrase', status: 'reorder', orderedWords: ['在用', '草稿'] }))
      .toEqual([{ fieldId: 'draft', weight: '111' }])
  })

  it('leaves fields unchanged on planner error, keep, and ask', () => {
    const [chain] = prepare([item('draft', '草稿', { weight: '120' })], [{ word: '在用', weight: 100 }])
    const result = { code: 'abcd', type: 'Phrase', orderedWords: ['草稿', '在用'] } as const
    expect(planDraftOrderWeights(chain, { ...result, orderedWords: [...result.orderedWords], status: 'reorder' })).toBeNull()
    expect(chain.items[0].weight).toBe('120')
    for (const status of ['keep', 'ask'] as const) {
      expect(planDraftOrderWeights(chain, { ...result, orderedWords: [...result.orderedWords], status })).toEqual([])
    }
  })

  it('fills only still-empty requested rows with the same word, even after insertion or reordering', () => {
    const missing = item('missing', '待填', { code: '' })
    const typed = item('typed', '手填', { code: '' })
    const changed = item('changed', '改词', { code: '' })
    const existing = item('existing', '已有', { code: 'aaaa' })
    const deleted = item('delete', '待删', { code: '', action: 'Delete' })
    const response = ['已有', '待填', '手填', '改词', '待删'].map(word => ({ word, suggestion: 'efgh' }))

    expect(getDraftCodeFills([missing, typed, changed, existing, deleted], [
      { ...typed, code: 'user' }, { ...existing, code: '' }, { ...changed, word: '待填' }, deleted,
      item('inserted', '待填', { code: '' }), missing,
    ], response)).toEqual([{ fieldId: 'missing', code: 'efgh' }])
  })
})
