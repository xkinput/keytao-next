import { describe, expect, it } from 'vitest'

import {
  getPhraseWeightValidationError,
  hasHigherPriorityWeight,
  PHRASE_TYPE_CONFIGS,
  type PhraseType,
} from '@/lib/constants/phraseTypes'

describe('phrase weight contract', () => {
  it.each([
    ['Single', 10],
    ['Phrase', 100],
    ['Supplement', 100],
    ['Symbol', 10],
    ['Link', 10000],
    ['CSS', 100],
    ['CSSSingle', 10],
    ['English', 100],
  ] as Array<[PhraseType, number]>)('%s starts at its base and only accumulates upward', (type, base) => {
    expect(PHRASE_TYPE_CONFIGS[type].defaultWeight).toBe(base)
    expect(getPhraseWeightValidationError(base, type)).toBeNull()
    expect(getPhraseWeightValidationError(base + 1, type)).toBeNull()
    expect(getPhraseWeightValidationError(base - 1, type)).toContain(`基础值 ${base}`)
  })

  it('treats lower numeric weight as higher priority', () => {
    expect(hasHigherPriorityWeight(100, 101)).toBe(true)
    expect(hasHigherPriorityWeight(101, 100)).toBe(false)
    expect(hasHigherPriorityWeight(100, 100)).toBe(false)
  })
})
