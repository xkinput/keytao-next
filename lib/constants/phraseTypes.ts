// Phrase type definitions and utilities
// Aligned with KeyTao rime dictionary structure

export type PhraseType =
  | 'Single'       // 单字
  | 'Phrase'       // 词组
  | 'Supplement'   // 补充
  | 'Symbol'       // 符号
  | 'Link'         // 链接
  | 'CSS'          // 声笔笔（Consonant Stroke Stroke）
  | 'CSSSingle'    // 声笔笔单字（Consonant Stroke Stroke Single）
  | 'English'      // 英文

export interface PhraseTypeConfig {
  type: PhraseType
  label: string
  defaultWeight: number
  description?: string
  /** 对应的 Rime 词典文件名（不含前缀和 .dict.yaml 后缀） */
  rimeFileName?: string
}

export const PHRASE_TYPE_CONFIGS: Record<PhraseType, PhraseTypeConfig> = {
  Single: {
    type: 'Single',
    label: '单字',
    defaultWeight: 10,
    description: '单个汉字（包括常用字和超级字词）',
    rimeFileName: 'single'
  },
  Phrase: {
    type: 'Phrase',
    label: '词组',
    defaultWeight: 100,
    description: '常用词组',
    rimeFileName: 'phrase'
  },
  Supplement: {
    type: 'Supplement',
    label: '补充',
    defaultWeight: 100,
    description: '补充词条',
    rimeFileName: 'supplement'
  },
  Symbol: {
    type: 'Symbol',
    label: '符号',
    defaultWeight: 10,
    description: '特殊符号',
    rimeFileName: 'symbol'
  },
  Link: {
    type: 'Link',
    label: '链接',
    defaultWeight: 10000,
    description: '网址链接',
    rimeFileName: 'link'
  },
  CSS: {
    type: 'CSS',
    label: '声笔笔',
    defaultWeight: 100,
    description: '声笔笔',
    rimeFileName: 'css'
  },
  CSSSingle: {
    type: 'CSSSingle',
    label: '声笔笔单字',
    defaultWeight: 10,
    description: '声笔笔单字',
    rimeFileName: 'css-single'
  },
  English: {
    type: 'English',
    label: '英文',
    defaultWeight: 100,
    description: '英文单词和短语',
    rimeFileName: 'english'
  }
}

export const PHRASE_TYPES = Object.keys(PHRASE_TYPE_CONFIGS) as PhraseType[]

/**
 * Get default weight for a phrase type
 */
export function getDefaultWeight(type: PhraseType): number {
  return PHRASE_TYPE_CONFIGS[type]?.defaultWeight || 100
}

/**
 * Get label for a phrase type
 */
export function getPhraseTypeLabel(type: PhraseType): string {
  return PHRASE_TYPE_CONFIGS[type]?.label || type
}

/**
 * Get all phrase types for selection
 */
export function getPhraseTypeOptions() {
  return PHRASE_TYPES.map(type => ({
    value: type,
    label: PHRASE_TYPE_CONFIGS[type].label,
    defaultWeight: PHRASE_TYPE_CONFIGS[type].defaultWeight
  }))
}

/**
 * Validate phrase type
 */
export function isValidPhraseType(type: string): type is PhraseType {
  return PHRASE_TYPES.includes(type as PhraseType)
}

/**
 * Detect phrase type based on word content and code
 */
export function detectPhraseType(word: string, code?: string): PhraseType {
  if (!word) return 'Phrase'

  // Symbol: special characters, punctuation, or starts with semicolon
  if (code?.startsWith(';') || /^[\p{P}\p{S}]+$/u.test(word)) {
    return 'Symbol'
  }

  // Link: contains http/https or www
  if (/https?:\/\/|www\./i.test(word)) {
    return 'Link'
  }

  // English: contains any English letters
  if (/[a-zA-Z]/.test(word)) {
    return 'English'
  }

  // Single: exactly one CJK character
  const cjkCount = (word.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length
  if (cjkCount === 1 && word.length === 1) {
    return 'Single'
  }

  // Default: Phrase for multi-character Chinese words
  return 'Phrase'
}

/**
 * Check if word type matches expected type, return suggestion if mismatch
 */
export function checkTypeMismatch(word: string, code: string | undefined, currentType: PhraseType): {
  hasTypeMismatch: boolean
  suggestedType?: PhraseType
  suggestedTypeLabel?: string
} {
  if (!word) {
    return { hasTypeMismatch: false }
  }

  const detectedType = detectPhraseType(word, code)

  // Skip check for Supplement and CSS types (user intentional choices)
  if (currentType === 'Supplement' || currentType === 'CSS' || currentType === 'CSSSingle') {
    return { hasTypeMismatch: false }
  }

  if (detectedType !== currentType) {
    return {
      hasTypeMismatch: true,
      suggestedType: detectedType,
      suggestedTypeLabel: getPhraseTypeLabel(detectedType)
    }
  }

  return { hasTypeMismatch: false }
}
