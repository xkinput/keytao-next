import type { PhraseType } from '@/lib/constants/phraseTypes'

export type BatchAiReviewVerdict = 'pass' | 'needs_attention' | 'manual_review'
export type BatchAiReviewStatus = 'pass' | 'attention' | 'manual_review'
export type BatchAiReviewSeverity = 'success' | 'warning' | 'danger' | 'default'

export interface BatchAiReviewRecord {
  reviewedBy: 'Miaomiao'
  source: 'bot-remark' | 'bot-llm' | 'system'
  summary: string
  pronunciation?: string
  sources: string[]
  /** Explicit dictionary, encyclopedia, or other named reference sources. */
  authoritySources?: string[]
  /** Entity-context and language-common-sense evidence, kept separate from named references. */
  commonSenseSources?: string[]
  evidence: string[]
}

export interface BatchAiReviewItem {
  prId: number
  status: BatchAiReviewStatus
  severity: BatchAiReviewSeverity
  title: string
  reasons: string[]
  suggestions: string[]
  reviewRecord?: BatchAiReviewRecord
}

export interface BatchAiReviewChainEntry {
  word: string
  code: string
  type: PhraseType
  weight: number | null
  source: 'current' | 'draft'
  action?: string
  prId?: number
}

export interface BatchAiReviewCodeChain {
  code: string
  type: PhraseType
  before: BatchAiReviewChainEntry[]
  after: BatchAiReviewChainEntry[]
  recommendations: string[]
}

export interface BatchAiReviewResult {
  reviewer: 'Miaomiao'
  generatedAt: string
  verdict: BatchAiReviewVerdict
  headline: string
  suggestedReviewNote: string
  riskCounts: {
    pass: number
    attention: number
    manualReview: number
    botReviewed: number
  }
  checklist: string[]
  items: BatchAiReviewItem[]
  codeChains: BatchAiReviewCodeChain[]
}
