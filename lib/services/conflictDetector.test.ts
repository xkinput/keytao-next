import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    phrase: {
      findFirst: prismaMocks.findFirst,
    },
  },
}))

import { getMaxCodeLength } from '@/lib/constants/codeValidation'
import { ConflictDetector, generateAlternativeCodes } from './conflictDetector'

describe('ConflictDetector code length cap', () => {
  beforeEach(() => {
    prismaMocks.findFirst.mockReset()
    prismaMocks.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if (where.code === 'lxmmov' && !where.word) {
        return {
          id: 1,
          word: '粮棉',
          code: 'lxmmov',
          weight: 100,
          userId: 1,
          type: 'Phrase',
        }
      }
      return null
    })
  })

  it('returns no length-extending alternatives for a 6-character Phrase code', () => {
    expect(generateAlternativeCodes('abcdef', 'Phrase')).toEqual([])
  })

  it.each([
    ['Symbol', 'a'.repeat(getMaxCodeLength('Symbol'))],
    ['Link', 'a'.repeat(getMaxCodeLength('Link'))],
    ['English', 'a'.repeat(getMaxCodeLength('English'))],
  ] as const)('respects the %s type boundary', (type, code) => {
    expect(generateAlternativeCodes(code, type)).toEqual([])
  })

  it('never suggests lxmmova or lxmmovv when relocating 粮棉 from lxmmov', async () => {
    const result = await new ConflictDetector().checkConflict({
      action: 'Create',
      word: '粮棉测试',
      code: 'lxmmov',
      type: 'Phrase',
    })

    const suggestedCodes = result.suggestions
      .map((suggestion) => suggestion.toCode)
      .filter((code): code is string => Boolean(code))

    expect(suggestedCodes).not.toContain('lxmmova')
    expect(suggestedCodes).not.toContain('lxmmovv')
    expect(suggestedCodes.every((code) => code.length <= 6)).toBe(true)
  })
})
