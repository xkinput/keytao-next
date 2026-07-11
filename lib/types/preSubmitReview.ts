import type { PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchConflictResult } from '@/lib/services/batchConflictService'
import type { BatchSubmitWarning } from '@/lib/services/batchSubmitWarnings'
import type { BatchAiReviewResult } from './batchAiReview'

export interface PreSubmitReviewItem {
  id: string
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord?: string
  code: string
  weight?: number
  type?: PhraseType
  remark?: string
}

export type PreSubmitReviewSource = 'bot_llm' | 'local_fallback' | 'local_rules'
export type PreSubmitRecommendation = 'ready' | 'confirm' | 'blocked'

export interface PreSubmitReviewResponse {
  results: BatchConflictResult[]
  warnings: BatchSubmitWarning[]
  review: BatchAiReviewResult
  reviewSource: PreSubmitReviewSource
  reviewError?: string
  recommendation: PreSubmitRecommendation
  canSubmit: boolean
  blockers: string[]
  reviewItemIds: Record<string, string>
}
