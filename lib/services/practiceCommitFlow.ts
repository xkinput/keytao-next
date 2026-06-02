import type { RimeComposition } from '@/lib/librime-wasm/types'

export type PracticeCommitResolution =
  | { type: 'noop' }
  | { type: 'partial'; text: string }
  | { type: 'complete'; carryOverComposition: RimeComposition | null }
  | { type: 'mismatch'; attemptedText: string; targetText: string }

export type FollowPracticeCommitResolution =
  | { type: 'noop' }
  | {
    type: 'match'
    advanceCount: number
    completedTexts: string[]
    currentText: string
    lastCompletedText: string | null
    carryOverComposition: RimeComposition | null
  }
  | { type: 'mismatch'; attemptedText: string; targetText: string }

export type FollowCurrentItemSegment = {
  text: string
  tone: 'done' | 'wrong' | 'pending'
}

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

export function resolveFollowPracticeCommit(params: {
  currentCommittedText: string
  committedText: string
  remainingTexts: string[]
  remainingTargetText?: string
  composition?: RimeComposition | null
}): FollowPracticeCommitResolution {
  const { currentCommittedText, committedText, remainingTexts, remainingTargetText = remainingTexts.join(''), composition } = params

  if (remainingTexts.length === 0 || !committedText) return { type: 'noop' }

  const nextCommittedText = `${currentCommittedText}${committedText}`
  if (!remainingTargetText.startsWith(nextCommittedText)) {
    return {
      type: 'mismatch',
      attemptedText: nextCommittedText,
      targetText: remainingTargetText.slice(0, Math.max(nextCommittedText.length, 1)),
    }
  }

  const completedTexts: string[] = []
  let currentText = nextCommittedText

  for (const text of remainingTexts) {
    if (!currentText.startsWith(text)) break
    completedTexts.push(text)
    currentText = currentText.slice(text.length)
  }

  return {
    type: 'match',
    advanceCount: completedTexts.length,
    completedTexts,
    currentText,
    lastCompletedText: completedTexts.at(-1) ?? null,
    carryOverComposition: hasActiveRimeComposition(composition) ? composition : null,
  }
}

export function splitFollowCurrentItemText(targetText: string, committedText: string): FollowCurrentItemSegment[] {
  const targetChars = Array.from(targetText)
  const committedChars = Array.from(committedText)
  const maxLength = Math.max(targetChars.length, committedChars.length)
  const segments: FollowCurrentItemSegment[] = []

  for (let index = 0; index < maxLength; index += 1) {
    const committedChar = committedChars[index]
    const targetChar = targetChars[index]
    const nextSegment = committedChar
      ? {
        text: committedChar,
        tone: committedChar === targetChar ? 'done' as const : 'wrong' as const,
      }
      : targetChar
        ? {
          text: targetChar,
          tone: 'pending' as const,
        }
        : null

    if (!nextSegment) continue

    const previousSegment = segments.at(-1)
    if (previousSegment && previousSegment.tone === nextSegment.tone) {
      previousSegment.text += nextSegment.text
      continue
    }

    segments.push(nextSegment)
  }

  return segments
}

export function splitFollowRemainingTexts(itemTexts: string[], committedText: string): FollowCurrentItemSegment[][] {
  const committedChars = Array.from(committedText)
  let committedIndex = 0

  return itemTexts.map((itemText, itemIndex) => {
    const itemSegments: FollowCurrentItemSegment[] = []

    for (const targetChar of Array.from(itemText)) {
      const committedChar = committedChars[committedIndex]
      const nextSegment = committedChar === undefined
        ? { text: targetChar, tone: 'pending' as const }
        : {
          text: committedChar,
          tone: committedChar === targetChar ? 'done' as const : 'wrong' as const,
        }

      if (committedChar !== undefined) committedIndex += 1

      const previousSegment = itemSegments.at(-1)
      if (previousSegment && previousSegment.tone === nextSegment.tone) {
        previousSegment.text += nextSegment.text
        continue
      }

      itemSegments.push(nextSegment)
    }

    if (itemIndex === itemTexts.length - 1 && committedIndex < committedChars.length) {
      const overflowSegment: FollowCurrentItemSegment = {
        text: committedChars.slice(committedIndex).join(''),
        tone: 'wrong',
      }
      const previousSegment = itemSegments.at(-1)
      if (previousSegment && previousSegment.tone === overflowSegment.tone) {
        previousSegment.text += overflowSegment.text
      } else {
        itemSegments.push(overflowSegment)
      }
    }

    return itemSegments
  })
}
