// Code validation constants and utilities.
//
// This module is the single source of truth for phrase code validation.
// Every write path (web, bot, personal API, admin import) must go through
// `isValidCode` / `getCodeValidationError` so that nothing that cannot appear
// in a Rime dictionary ever reaches the database.

import type { PhraseType } from './phraseTypes'

/**
 * Phrase code validation regex
 * Allows:
 * - Pure letters: abc, XYZ
 * - Semicolon + letters: ;abc, ;xyz
 * - Single semicolon: ;
 * - Double semicolon: ;;
 */
export const CODE_PATTERN = /^;{1,2}$|^;?[a-zA-Z]+$/

/**
 * Default maximum code length, used for the Chinese-side dictionaries.
 *
 * KeyTao encodes Chinese entries phonetically: every syllable contributes at
 * most two keys (声母 + 韵母/字根). The published rime dictionaries therefore
 * top out at 6 keys per entry (e.g. 「小恙」 -> `xcypio`), which is also the
 * longest code the input scheme will ever look up. Anything longer is dead
 * weight in the dictionary and is almost always a typo or a bad import.
 */
export const DEFAULT_MAX_CODE_LENGTH = 6

/**
 * Backwards-compatible alias. Prefer `getMaxCodeLength(type)`.
 */
export const MAX_CODE_LENGTH = DEFAULT_MAX_CODE_LENGTH

/**
 * Per-type maximum code length.
 *
 * Rationale (derived from the eight rime dictionaries emitted by
 * `lib/services/rimeConverter.ts`):
 *
 * - Single / Phrase / Supplement / CSS / CSSSingle are Chinese-side
 *   dictionaries using the phonetic/字根 encoding described above -> 6.
 * - Symbol / Link entries are `;`-prefixed mnemonics rather than phonetic
 *   codes (`;`, `;;`, `;gh`, ...). They are hand-picked shortcuts, so they get
 *   a little headroom but still stay short enough to be typeable.
 * - English entries are typed as the latin word itself, so the ceiling is set
 *   by natural English word length rather than by the encoding scheme. 20 also
 *   matches the limit the public lookup endpoints already enforce.
 */
export const MAX_CODE_LENGTH_BY_TYPE: Record<PhraseType, number> = {
  Single: DEFAULT_MAX_CODE_LENGTH,
  Phrase: DEFAULT_MAX_CODE_LENGTH,
  Supplement: DEFAULT_MAX_CODE_LENGTH,
  CSS: DEFAULT_MAX_CODE_LENGTH,
  CSSSingle: DEFAULT_MAX_CODE_LENGTH,
  Symbol: 12,
  Link: 12,
  English: 20,
}

/**
 * Longest code accepted by any type. Read-only lookup endpoints (by-code
 * queries) use this so that every storable code stays searchable.
 */
export const MAX_CODE_LENGTH_ANY_TYPE = Math.max(
  ...Object.values(MAX_CODE_LENGTH_BY_TYPE)
)

/**
 * Resolve the maximum code length for a phrase type.
 * Unknown / missing types fall back to the strict Chinese-side limit.
 */
export function getMaxCodeLength(type?: PhraseType | string | null): number {
  if (!type) return DEFAULT_MAX_CODE_LENGTH
  return MAX_CODE_LENGTH_BY_TYPE[type as PhraseType] ?? DEFAULT_MAX_CODE_LENGTH
}

/**
 * Validate phrase code format and length
 */
export function isValidCode(code: string, type?: PhraseType | string | null): boolean {
  return getCodeValidationError(code, type) === null
}

/**
 * Get code validation error message
 */
export function getCodeValidationError(
  code: string,
  type?: PhraseType | string | null
): string | null {
  if (!code) {
    return '编码不能为空'
  }
  const maxLength = getMaxCodeLength(type)
  if (code.length > maxLength) {
    return `编码长度超过${maxLength}个字符`
  }
  if (!CODE_PATTERN.test(code)) {
    return '编码格式错误'
  }
  return null
}
