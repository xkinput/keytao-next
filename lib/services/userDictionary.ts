import { detectPhraseType, getDefaultWeight, getPhraseWeightValidationError, isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'
import { containsMiaomiaoReviewBlockDelimiter } from '@/lib/validation/phraseInput'

export const USER_DICT_FILE_NAME = 'user.dict.yaml'
export const KEYTAO_USER_DICT_FILE_NAME = 'keytao.user.dict.yaml'
export const USER_DICT_NAME = 'user'
export const KEYTAO_USER_DICT_NAME = 'keytao.user'

const MAX_WORD_LENGTH = 100
const MAX_CODE_LENGTH = 64
const MAX_REMARK_LENGTH = 500
const MAX_WEIGHT = 1_000_000

export class UserDictionaryInputError extends Error {
  status = 400
}

export interface UserDictionaryInput {
  word: string
  code: string
  type: PhraseType
  weight: number
  remark: string | null
  replacePublic: boolean
}

export interface UserDictionaryYamlEntry {
  word: string
  code: string
  weight: number
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function assertRimeField(label: string, value: string, maxLength: number) {
  if (!value || value.length > maxLength || /[\t\r\n]/.test(value)) {
    throw new UserDictionaryInputError(`${label}格式不正确`)
  }
}

function normalizeWeight(value: unknown, type: PhraseType): number {
  if (value === undefined || value === null || value === '') {
    return getDefaultWeight(type)
  }

  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_WEIGHT) {
    throw new UserDictionaryInputError('权重格式不正确')
  }
  const weightError = getPhraseWeightValidationError(parsed, type)
  if (weightError) throw new UserDictionaryInputError(weightError)

  return parsed
}

export function normalizeUserDictionaryInput(input: Record<string, unknown>): UserDictionaryInput {
  const word = normalizeText(input.word)
  const code = normalizeText(input.code)
  assertRimeField('词条', word, MAX_WORD_LENGTH)
  assertRimeField('编码', code, MAX_CODE_LENGTH)

  const typeValue = normalizeText(input.type)
  const type = typeValue
    ? isValidPhraseType(typeValue)
      ? typeValue
      : null
    : detectPhraseType(word, code)

  if (!type) {
    throw new UserDictionaryInputError('词条类型不正确')
  }

  const remark = input.remark === undefined || input.remark === null
    ? null
    : normalizeText(input.remark)

  if (remark && remark.length > MAX_REMARK_LENGTH) {
    throw new UserDictionaryInputError('备注过长')
  }
  if (remark && containsMiaomiaoReviewBlockDelimiter(remark)) {
    throw new UserDictionaryInputError('备注不能包含喵喵复审块标记')
  }

  return {
    word,
    code,
    type,
    weight: normalizeWeight(input.weight, type),
    remark: remark || null,
    replacePublic: input.replacePublic === undefined ? true : Boolean(input.replacePublic),
  }
}

function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

export function buildUserDictionaryYaml(
  entries: UserDictionaryYamlEntry[],
  options: { name?: string; title?: string; version?: string } = {}
) {
  const name = options.name ?? USER_DICT_NAME
  const title = options.title ?? 'KeyTao user dictionary'
  const version = options.version ?? new Date().toISOString().slice(0, 10)
  const lines = [
    '# Rime dictionary',
    '# encoding: utf-8',
    `# ${title}`,
    '---',
    `name: ${name}`,
    `version: ${yamlScalar(version)}`,
    'sort: original',
    'use_preset_vocabulary: false',
    '...',
    '# word<TAB>code<TAB>weight',
  ]

  for (const entry of entries) {
    if (!entry.word || !entry.code || /[\t\r\n]/.test(entry.word) || /[\t\r\n]/.test(entry.code)) {
      continue
    }
    lines.push(`${entry.word}\t${entry.code}\t${entry.weight}`)
  }

  return `${lines.join('\n')}\n`
}
