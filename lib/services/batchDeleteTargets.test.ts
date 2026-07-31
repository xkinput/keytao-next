import { describe, expect, it } from 'vitest'
import { assertExpectedBatchTargets, BatchTargetChangedError } from './batchDeleteTargets'

describe('assertExpectedBatchTargets', () => {
  const target = { id: 1, word: '测试', code: 'ces', action: 'Create', type: 'Phrase' }

  it('accepts only a complete exact snapshot', () => {
    expect(() => assertExpectedBatchTargets([target], [target])).not.toThrow()
  })

  it('rejects a reused id whose content changed', () => {
    expect(() => assertExpectedBatchTargets(
      [target],
      [{ ...target, word: '恶意替换' }]
    )).toThrow(BatchTargetChangedError)
  })
})
