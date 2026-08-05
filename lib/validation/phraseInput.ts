// Shared validation for every phrase write path.
//
// The dictionary artefacts produced by `lib/services/rimeConverter.ts` are
// tab-separated Rime files, so a tab / CR / LF (or any other control
// character) inside a word or a code silently corrupts the generated
// dictionary. Every endpoint that persists a Phrase or a PullRequest must run
// its payload through `validatePhraseInput` before touching the database.

import { getCodeValidationError } from '@/lib/constants/codeValidation'
import { isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'
import {
  extractMiaomiaoReviewBlocks,
  MIAOMIAO_REVIEW_BLOCK_END,
  MIAOMIAO_REVIEW_BLOCK_START,
  stripMiaomiaoReviewRemark,
} from '@/lib/services/miaomiaoReviewRemark'

export const MAX_WORD_LENGTH = 100
export const MAX_REMARK_LENGTH = 500

/**
 * Every non-printable control character:
 *   U+0000-U+001F  C0 controls (includes \t, \r, \n — the ones that actually
 *                  break the TSV dictionary format)
 *   U+007F-U+009F  DEL plus the full C1 range (includes NEL U+0085)
 *   U+2028/U+2029  Unicode line / paragraph separators
 */
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/
const MIAOMIAO_REVIEW_BLOCK_DELIMITERS = [
  MIAOMIAO_REVIEW_BLOCK_START,
  MIAOMIAO_REVIEW_BLOCK_END,
] as const

/**
 * True when the text contains a character that must never reach a Rime
 * dictionary file.
 */
export function containsControlCharacters(value: string): boolean {
  return CONTROL_CHAR_PATTERN.test(value)
}

/** True when caller text could be parsed as a server-authored review block. */
export function containsMiaomiaoReviewBlockDelimiter(value: string): boolean {
  return MIAOMIAO_REVIEW_BLOCK_DELIMITERS.some(delimiter => value.includes(delimiter))
}

/**
 * True when an update adds, changes, duplicates, or removes a persisted review
 * block. Ordinary text outside byte-identical complete blocks may still change.
 */
export function changesPersistedMiaomiaoReviewBlocks(
  nextRemark: string | null | undefined,
  persistedRemark: string | null | undefined,
): boolean {
  if (nextRemark === undefined) return false

  const nextText = nextRemark ?? ''
  const persistedText = persistedRemark ?? ''
  if (
    !containsMiaomiaoReviewBlockDelimiter(nextText)
    && !containsMiaomiaoReviewBlockDelimiter(persistedText)
  ) {
    return false
  }

  const nextBlocks = extractMiaomiaoReviewBlocks(nextText)
  const persistedBlocks = extractMiaomiaoReviewBlocks(persistedText)
  if (containsMiaomiaoReviewBlockDelimiter(stripMiaomiaoReviewRemark(nextText))) {
    return true
  }
  if (nextBlocks.length !== persistedBlocks.length) return true
  return nextBlocks.some((block, index) => block !== persistedBlocks[index])
}

export interface PhraseInputCandidate {
  word: unknown
  code: unknown
  type?: unknown
  oldWord?: unknown
  remark?: unknown
  /** Set for Change actions: `oldWord` then becomes mandatory. */
  action?: unknown
}

export class PhraseInputError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'PhraseInputError'
  }
}

/**
 * Validate a single phrase payload.
 *
 * Returns a human readable Chinese error message, or `null` when the payload
 * is safe to persist. Callers are expected to have trimmed `word` / `code`
 * first (trimming does not remove inner control characters).
 */
export function validatePhraseInput(input: PhraseInputCandidate): string | null {
  const { word, code, type, oldWord, remark, action } = input

  if (typeof word !== 'string' || typeof code !== 'string') {
    return '词条和编码必须是字符串'
  }

  if (!word) {
    return '词条不能为空'
  }
  if (word.length > MAX_WORD_LENGTH) {
    return `词条最多 ${MAX_WORD_LENGTH} 个字符`
  }
  if (containsControlCharacters(word)) {
    return '词条不能包含制表符、换行符或其他控制字符'
  }

  if (type !== undefined && type !== null && type !== '') {
    if (typeof type !== 'string' || !isValidPhraseType(type)) {
      return `不支持的词库类型：${String(type)}`
    }
  }

  if (containsControlCharacters(code)) {
    return '编码不能包含制表符、换行符或其他控制字符'
  }
  const codeError = getCodeValidationError(code, type as PhraseType | undefined)
  if (codeError) {
    return codeError
  }

  if (oldWord !== undefined && oldWord !== null && oldWord !== '') {
    if (typeof oldWord !== 'string') {
      return '旧词必须是字符串'
    }
    if (oldWord.length > MAX_WORD_LENGTH) {
      return `旧词最多 ${MAX_WORD_LENGTH} 个字符`
    }
    if (containsControlCharacters(oldWord)) {
      return '旧词不能包含制表符、换行符或其他控制字符'
    }
  } else if (action === 'Change') {
    return '修改操作需要指定旧词'
  }

  if (remark !== undefined && remark !== null) {
    if (typeof remark !== 'string') {
      return '备注必须是字符串'
    }
    if (remark.length > MAX_REMARK_LENGTH) {
      return `备注最多 ${MAX_REMARK_LENGTH} 个字符`
    }
    if (containsMiaomiaoReviewBlockDelimiter(remark)) {
      return '备注不能包含喵喵复审块标记'
    }
    if (containsControlCharacters(remark.replace(/[\r\n]/g, ''))) {
      return '备注不能包含控制字符'
    }
  }

  return null
}

/**
 * Normalise the bot-only `needsManualReview` flag.
 *
 * Strictly boolean: silently coercing `"true"` / `1` / `"false"` would be
 * dangerous in both directions — a truthy string that we downgrade to `false`
 * would let a flagged entry through bot auto-approval, which is exactly what
 * the flag exists to prevent. Anything that is not a boolean is rejected.
 */
export function normalizeNeedsManualReview(value: unknown, label = ''): boolean {
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') {
    throw new PhraseInputError(`${label}needsManualReview 必须是布尔值（true / false）`)
  }
  return value
}

/**
 * Same as {@link validatePhraseInput} but throws a {@link PhraseInputError}.
 * Handy inside `.map()` normalisation loops.
 */
export function assertValidPhraseInput(
  input: PhraseInputCandidate,
  labelPrefix?: string
): void {
  const error = validatePhraseInput(input)
  if (error) {
    throw new PhraseInputError(labelPrefix ? `${labelPrefix}${error}` : error)
  }
}
