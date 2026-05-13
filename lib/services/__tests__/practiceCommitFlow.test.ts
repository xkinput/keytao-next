import { describe, expect, it } from 'vitest'

import type { RimeComposition } from '@/lib/librime-wasm/types'
import {
  hasActiveRimeComposition,
  resolveFollowPracticeCommit,
  resolvePracticeCommit,
  splitFollowCurrentItemText,
  splitFollowRemainingTexts,
} from '@/lib/services/practiceCommitFlow'

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

  it('allows follow mode commits to advance across multiple practice items', () => {
    expect(resolveFollowPracticeCommit({
      currentCommittedText: '',
      committedText: '天地立',
      remainingTexts: ['天地', '立心', '以键'],
      composition: activeComposition,
    })).toEqual({
      type: 'match',
      advanceCount: 1,
      completedTexts: ['天地'],
      currentText: '立',
      lastCompletedText: '天地',
      carryOverComposition: activeComposition,
    })
  })

  it('marks mismatched follow mode commits without forcing the current item prefix rule', () => {
    expect(resolveFollowPracticeCommit({
      currentCommittedText: '',
      committedText: '天人',
      remainingTexts: ['天地', '立心'],
    })).toEqual({
      type: 'mismatch',
      attemptedText: '天人',
      targetText: '天地',
    })
  })

  it('splits the current follow item so the first correct character can render immediately', () => {
    expect(splitFollowCurrentItemText('清晨', '清')).toEqual([
      { text: '清', tone: 'done' },
      { text: '晨', tone: 'pending' },
    ])
  })

  it('splits the current follow item so wrong characters render immediately', () => {
    expect(splitFollowCurrentItemText('的风', '三')).toEqual([
      { text: '三', tone: 'wrong' },
      { text: '风', tone: 'pending' },
    ])
  })

  it('covers follow-mode input across remaining items without pushing later matches backward', () => {
    expect(splitFollowRemainingTexts(['1', '23', '4'], '1x3')).toEqual([
      [{ text: '1', tone: 'done' }],
      [
        { text: 'x', tone: 'wrong' },
        { text: '3', tone: 'done' },
      ],
      [{ text: '4', tone: 'pending' }],
    ])
  })
})