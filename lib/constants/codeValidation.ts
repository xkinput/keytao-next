// Code validation constants and utilities

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
 * Maximum code length
 */
export const MAX_CODE_LENGTH = 6

/**
 * Validate phrase code format and length
 */
export function isValidCode(code: string): boolean {
  if (!code || code.length > MAX_CODE_LENGTH) {
    return false
  }
  return CODE_PATTERN.test(code)
}

/**
 * Get code validation error message
 */
export function getCodeValidationError(code: string): string | null {
  if (!code) {
    return '编码不能为空'
  }
  if (code.length > MAX_CODE_LENGTH) {
    return `编码长度超过${MAX_CODE_LENGTH}个字符`
  }
  if (!CODE_PATTERN.test(code)) {
    return '编码格式错误'
  }
  return null
}
