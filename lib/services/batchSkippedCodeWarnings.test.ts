import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  encodePhrase: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    phrase: {
      findMany: mocks.findMany,
    },
  },
}))

vi.mock('./keytaoEncoder', () => ({
  encodePhrase: mocks.encodePhrase,
}))

import {
  buildSkippedCandidateSlotWarnings,
  collectSkippedCandidateSlotDependencies,
} from './batchSkippedCodeWarnings'

const LITIGATION_FEE_ITEM = {
  id: 'litigation-fee',
  action: 'Create' as const,
  word: '诉讼费',
  code: 'ssfoo',
  type: 'Phrase' as const,
  weight: 100,
}

describe('buildSkippedCandidateSlotWarnings cross-type occupancy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.encodePhrase.mockResolvedValue({
      codes: ['ssf', 'ssfo', 'ssfoo'],
      altCodes: [],
      flyKeyVariants: [],
      type: 'Phrase',
    })
  })

  it('does not warn that ssf is skipped for Phrase 诉讼费 at ssfoo when English AA制 occupies ssf', async () => {
    mocks.findMany.mockImplementation(async ({ where }) => {
      const requestedCodes = where?.code?.in
      if (Array.isArray(requestedCodes) && requestedCodes.includes('ssf') && where.type === undefined) {
        return [
          { word: 'AA制', code: 'ssf', type: 'English', weight: 100 },
          { word: '诉讼法', code: 'ssfo', type: 'Phrase', weight: 100 },
        ]
      }
      return []
    })

    await expect(buildSkippedCandidateSlotWarnings([LITIGATION_FEE_ITEM])).resolves.toEqual([])
  })

  it('warns when the shorter ssf code is genuinely empty across all types', async () => {
    mocks.findMany.mockResolvedValue([])

    const warnings = await buildSkippedCandidateSlotWarnings([LITIGATION_FEE_ITEM])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      id: 'litigation-fee',
      word: '诉讼费',
      code: 'ssfoo',
      warningType: 'skipped_candidate_slot',
      skippedCode: 'ssf',
      skippedCodes: ['ssf', 'ssfo'],
    })
  })

  it('binds skipped candidate dependencies by cross-type code', async () => {
    await expect(collectSkippedCandidateSlotDependencies([LITIGATION_FEE_ITEM])).resolves.toEqual([
      { code: 'ssf' },
      { code: 'ssfo' },
    ])
  })
})
