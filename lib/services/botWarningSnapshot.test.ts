import { beforeEach, describe, expect, it, vi } from 'vitest'

const { collectSkippedCandidateSlotDependencies } = vi.hoisted(() => ({
  collectSkippedCandidateSlotDependencies: vi.fn(),
}))

vi.mock('./batchSkippedCodeWarnings', () => ({
  collectSkippedCandidateSlotDependencies,
}))

import { buildBotWarningDigest } from './botWarningSnapshot'

describe('buildBotWarningDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    collectSkippedCandidateSlotDependencies.mockResolvedValue([
      { code: 'ab' },
    ])
  })

  it('binds skipped candidate predecessor slots into the warning snapshot', async () => {
    const findMany = vi.fn(async () => [])

    await buildBotWarningDigest(
      { phrase: { findMany } } as never,
      [{ id: '1', action: 'Create', word: '测试', code: 'abc', type: 'Phrase' }],
      { warnings: [] }
    )

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: expect.arrayContaining([
          { code: 'ab' },
        ]),
      },
      select: expect.objectContaining({ status: true }),
    }))
  })
})
