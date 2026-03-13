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

export interface BotDeleteNoteInfo {
  index: number
  word: string
  code: string
  weight: number
  type?: string
}

export interface BotCreatePRResponse {
  success: boolean
  message: string

  // On success
  batchId?: string
  pullRequestCount?: number

  // Informational notes about Delete operations (non-blocking)
  notes?: BotDeleteNoteInfo[]

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

// ── Batch draft add ──────────────────────────────────────────────────────────

export interface BotBatchDraftItem {
  word: string
  code: string
  action?: 'Create' | 'Change' | 'Delete'
  oldWord?: string
  type?: string
  remark?: string
}

export interface BotBatchDraftRequest {
  platform: 'qq' | 'telegram'
  platformId: string
  items: BotBatchDraftItem[]
  batchId?: string
}

export interface BotBatchDraftFailedItem {
  index: number
  word: string
  code: string
  reason: string
}

export interface BotDraftSnapshotItem {
  id: number
  action: string
  word: string
  code: string
  type: string
  status: string
  hasWarning?: boolean
  warningNote?: string
}

export interface BotBatchDraftResponse {
  success: boolean
  message: string
  batchId?: string
  successCount: number
  failedCount: number
  skippedCount: number
  failed: BotBatchDraftFailedItem[]
  skipped: BotBatchDraftFailedItem[]
  draftItems: BotDraftSnapshotItem[]
  draftTotal: number
}

export interface BotBatchDeleteDraftRequest {
  platform: 'qq' | 'telegram'
  platformId: string
  ids: number[]
}

export interface BotBatchDeleteDraftDeletedItem {
  id: number
  word: string
  code: string
  action: string
}

export interface BotBatchDeleteDraftFailedItem {
  id: number
  reason: string
}

export interface BotBatchDeleteDraftResponse {
  success: boolean
  message: string
  batchId?: string
  successCount: number
  failedCount: number
  deleted: BotBatchDeleteDraftDeletedItem[]
  failed: BotBatchDeleteDraftFailedItem[]
  draftItems: BotDraftSnapshotItem[]
  draftTotal: number
}
