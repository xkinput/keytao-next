import type { PhraseType } from '@/lib/constants/phraseTypes'

export const COMMONNESS_ORDER_LIMITS = { chains: 20, entries: 8, words: 120, codeLength: 16 }

const lineBreaks = new Set([10, 11, 12, 13, 28, 29, 30, 133, 8232, 8233])

export function isCommonnessOrderWord(word: unknown): word is string {
  if (typeof word !== 'string' || !word.trim()) return false
  const characters = Array.from(word)
  return characters.length <= 30 && characters.every(character => !lineBreaks.has(character.charCodeAt(0)))
}

export interface CommonnessOrderSlot {
  code: string
  type: PhraseType
}

export function draftOrderKey(code: string, type: string) {
  return `${code}|${type}`
}

export interface CommonnessOrderChain extends CommonnessOrderSlot {
  entries: Array<{ word: string; weight: number | null; source: 'current' | 'draft'; prId?: number }>
}

export interface CommonnessOrderResult extends CommonnessOrderSlot {
  status: 'reorder' | 'keep' | 'ask'
  orderedWords: string[]
}

export interface CommonnessLines {
  daily?: string
  authority?: string
}

export interface CommonnessOrderResponse {
  chains: CommonnessOrderResult[]
  words: Record<string, CommonnessLines>
  reservedWeights: Record<string, number[]>
}
