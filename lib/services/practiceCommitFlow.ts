import type { RimeComposition } from '@/lib/librime-wasm/types'

export type PracticeCommitResolution =
  | { type: 'noop' }
  | { type: 'partial'; text: string }
  | { type: 'complete'; carryOverComposition: RimeComposition | null }
  | { type: 'mismatch'; attemptedText: string; targetText: string }

export function hasActiveRimeComposition(composition: RimeComposition | null | undefined): composition is RimeComposition {
  if (!composition) return false

  return composition.preedit.trim().length > 0 || composition.candidates.length > 0
}

export function resolvePracticeCommit(params: {
  currentCommittedText: string
  committedText: string
  currentTargetText: string | undefined
  composition?: RimeComposition | null
}): PracticeCommitResolution {
  const { currentCommittedText, committedText, currentTargetText, composition } = params

  if (!currentTargetText || !committedText) return { type: 'noop' }

  const nextCommittedText = `${currentCommittedText}${committedText}`

  if (nextCommittedText === currentTargetText) {
    return {
      type: 'complete',
      carryOverComposition: hasActiveRimeComposition(composition) ? composition : null,
    }
  }

  if (currentTargetText.startsWith(nextCommittedText)) {
    return { type: 'partial', text: nextCommittedText }
  }

  return {
    type: 'mismatch',
    attemptedText: nextCommittedText,
    targetText: currentTargetText,
  }
}