import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, findUnique, upsert } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    phrase: {
      findMany,
    },
    zdicPinyinCache: {
      findUnique,
      upsert,
    },
  },
}))

import { inferPhrase, inferPhrases } from '../phraseInference'
import { setZdicLookupCacheClientForTests } from '../zdicLookupCache'

describe('phrase inference encoding', () => {
  beforeEach(() => {
    findMany.mockReset()
    findMany.mockResolvedValue([])
    findUnique.mockReset()
    findUnique.mockImplementation(({ where }) => {
      const { kind, entry } = where.kind_entry
      const characterPinyins: Record<string, string[]> = {
        '复': ['fù'],
        '购': ['gòu'],
        '率': ['shuài', 'lǜ'],
        '表': ['biǎo'],
      }
      const pinyins = kind === 'char' ? characterPinyins[entry] : undefined
      return Promise.resolve({
        kind,
        entry,
        status: pinyins ? 'found' : 'absent',
        pinyins: pinyins ?? [],
        fetchedAt: new Date(),
      })
    })
    upsert.mockReset()
    upsert.mockResolvedValue(undefined)
    setZdicLookupCacheClientForTests({ findUnique, upsert })
  })

  it('uses contextual lǜ codes in /api/phrases/infer data', async () => {
    const result = await inferPhrase('复购率')

    expect(result.codes).toEqual(['fgl', 'fglu', 'fglua', 'fgluao'])
    expect(result.suggestion).toBe('fgl')
  })

  it('uses the same contextual codes in batch inference', async () => {
    const [rate, exemplar] = await inferPhrases(['复购率', '表率'])

    expect(rate.codes).toEqual(['fgl', 'fglu', 'fglua', 'fgluao'])
    expect(exemplar.codes[0]).toBe('bceg')
  })

  it('exposes candidate occupants sorted by ascending weight in single and batch data', async () => {
    findMany.mockResolvedValue([
      { word: '高权重', code: 'fgl', weight: 100, type: 'Phrase' },
      { word: '低权重', code: 'fgl', weight: 20, type: 'Phrase' },
      { word: '占用二码', code: 'fglu', weight: 30, type: 'Phrase' },
      { word: '占用三码', code: 'fglua', weight: 40, type: 'Phrase' },
      { word: '占用四码', code: 'fgluao', weight: 50, type: 'Phrase' },
    ])

    const single = await inferPhrase('复购率')
    const [batch] = await inferPhrases(['复购率'])
    const expectedOccupancy = [
      {
        code: 'fgl',
        occupants: [
          { word: '低权重', weight: 20 },
          { word: '高权重', weight: 100 },
        ],
      },
      { code: 'fglu', occupants: [{ word: '占用二码', weight: 30 }] },
      { code: 'fglua', occupants: [{ word: '占用三码', weight: 40 }] },
      { code: 'fgluao', occupants: [{ word: '占用四码', weight: 50 }] },
    ]

    expect(single.candidateOccupancy).toEqual(expectedOccupancy)
    expect(single.suggestionStatus).toBe('occupied')
    expect(batch.candidateOccupancy).toEqual(expectedOccupancy)
    expect(batch.suggestionStatus).toBe('occupied')
  })
})
