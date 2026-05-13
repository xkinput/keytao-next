import { describe, expect, it } from 'vitest'

import type { RimeComposition } from '@/lib/librime-wasm/types'
import { hasActiveRimeComposition, resolvePracticeCommit } from '@/lib/services/practiceCommitFlow'

const activeComposition: RimeComposition = {
  preedit: 't',
  candidates: [{ text: '天下' }],
  highlightedIndex: 0,
  page: 0,
  isLastPage: true,
}

describe('practiceCommitFlow', () => {
  it('keeps carry-over composition when a commit finishes the current target', () => {
    expect(resolvePracticeCommit({
      currentCommittedText: '',
      committedText: '今天',
      currentTargetText: '今天',
      composition: activeComposition,
    })).toEqual({
      type: 'complete',
      carryOverComposition: activeComposition,
    })
  })

  it('drops empty composition when a commit finishes the current target', () => {
    expect(resolvePracticeCommit({
      currentCommittedText: '',
      committedText: '今天',
      currentTargetText: '今天',
      composition: {
        preedit: '   ',
        candidates: [],
        highlightedIndex: 0,
        page: 0,
        isLastPage: true,
      },
    })).toEqual({
      type: 'complete',
      carryOverComposition: null,
    })
  })

  it('marks partial and mismatched commits correctly', () => {
    expect(resolvePracticeCommit({
      currentCommittedText: '',
      committedText: '今',
      currentTargetText: '今天',
    })).toEqual({ type: 'partial', text: '今' })

    expect(resolvePracticeCommit({
      currentCommittedText: '今',
      committedText: '晚',
      currentTargetText: '今天',
    })).toEqual({
      type: 'mismatch',
      attemptedText: '今晚',
      targetText: '今天',
    })
  })

  it('detects whether a composition still has active input', () => {
    expect(hasActiveRimeComposition(activeComposition)).toBe(true)
    expect(hasActiveRimeComposition(null)).toBe(false)
  })
})