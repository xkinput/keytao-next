/**
 * Bot API Types
 * Types for bot-specific API endpoints
 */

export interface BotPRItem {
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord?: string // Required for Change action
  code: string
  type?: string // PhraseType, defaults to 'Phrase'
  weight?: number
  remark?: string
}

export interface BotCreatePRRequest {
  platform: 'qq' | 'telegram'
  platformId: string
  items: BotPRItem[]
  confirmed?: boolean // Set to true to confirm warnings
  batchId?: string // Optional batch ID to append to existing batch
}

export interface BotConflictInfo {
  index: number
  item: BotPRItem
  error: string
  reason: string
}

export interface BotWarningInfo {
  index: number
  item: BotPRItem
  warningType: 'duplicate_code' | 'multiple_code'
  message: string
  existing: {
    word: string
    code: string
    weight: number
  }
  // For Delete action with multiple_code warning, list all codes for this word
  allCodes?: Array<{
    code: string
    type: string
    weight: number
  }>
}

export interface BotCreatePRResponse {
  success: boolean
  message: string

  // On success
  batchId?: string
  pullRequestCount?: number

  // On conflict
  conflicts?: BotConflictInfo[]

  // On warning (needs confirmation)
  warnings?: BotWarningInfo[]
  requiresConfirmation?: boolean
}

export interface BotLookupPhrase {
  word: string
  code: string
  weight: number
  type: string
  remark: string | null
}

export interface BotBatchLookupByWordRequest {
  words: string[]
}

export interface BotBatchLookupByCodeRequest {
  codes: string[]
}

export interface BotBatchLookupByWordItem {
  word: string
  phrases: BotLookupPhrase[]
}

export interface BotBatchLookupByCodeItem {
  code: string
  phrases: BotLookupPhrase[]
}

export interface BotBatchLookupByWordResponse {
  success: boolean
  count: number
  results: BotBatchLookupByWordItem[]
  message?: string
}

export interface BotBatchLookupByCodeResponse {
  success: boolean
  count: number
  results: BotBatchLookupByCodeItem[]
  message?: string
}
