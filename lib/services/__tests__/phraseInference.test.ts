import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    phrase: {
      findMany,
    },
  },
}))

import { inferPhrase, inferPhrases } from '../phraseInference'

describe('phrase inference encoding', () => {
  beforeEach(() => {
    findMany.mockReset()
    findMany.mockResolvedValue([])
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
})
