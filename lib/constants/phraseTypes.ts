// Phrase type definitions and utilities

export type PhraseType = 'Single' | 'Phrase' | 'Sentence' | 'Symbol' | 'Link' | 'Poem' | 'Other'

export interface PhraseTypeConfig {
  type: PhraseType
  label: string
  defaultWeight: number
  description?: string
}

export const PHRASE_TYPE_CONFIGS: Record<PhraseType, PhraseTypeConfig> = {
  Single: {
    type: 'Single',
    label: '单字',
    defaultWeight: 10,
    description: '单个汉字'
  },
  Phrase: {
    type: 'Phrase',
    label: '词组',
    defaultWeight: 100,
    description: '常用词组'
  },
  Sentence: {
    type: 'Sentence',
    label: '短句',
    defaultWeight: 1000,
    description: '短句或长词组'
  },
  Symbol: {
    type: 'Symbol',
    label: '符号',
    defaultWeight: 10,
    description: '特殊符号'
  },
  Link: {
    type: 'Link',
    label: '链接',
    defaultWeight: 10000,
    description: '网址链接'
  },
  Poem: {
    type: 'Poem',
    label: '诗句',
    defaultWeight: 10000,
    description: '诗词名句'
  },
  Other: {
    type: 'Other',
    label: '其他',
    defaultWeight: 10000,
    description: '其他类型'
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
