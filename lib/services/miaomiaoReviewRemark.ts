import type { BatchAiReviewItem, BatchAiReviewRecord } from '@/lib/types/batchAiReview'

export const MIAOMIAO_REVIEW_BLOCK_START = '--- miao-review:start ---'
export const MIAOMIAO_REVIEW_BLOCK_END = '--- miao-review:end ---'

const MIAOMIAO_REVIEW_BLOCK_SOURCE = `${MIAOMIAO_REVIEW_BLOCK_START}([\\s\\S]*?)${MIAOMIAO_REVIEW_BLOCK_END}`
const MIAOMIAO_REVIEW_BLOCK_PATTERN = new RegExp(`\\n?${MIAOMIAO_REVIEW_BLOCK_SOURCE}`, 'g')
const MIAOMIAO_REVIEW_BLOCK_EXACT_PATTERN = new RegExp(MIAOMIAO_REVIEW_BLOCK_SOURCE, 'g')

export interface MiaomiaoReviewRemarkBlock {
  status?: string
  conclusion?: string
  reason?: string
  suggestion?: string
  pronunciation?: string
  commonness?: BatchAiReviewRecord['commonness']
  suggestedOrder?: BatchAiReviewItem['suggestedOrder']
  sources: string[]
  hasSourcesField: boolean
  evidence: string[]
  generatedAt?: string
  reviewDigest?: string
}

export interface ParsedMiaomiaoReviewRemark {
  baseRemark: string
  review?: MiaomiaoReviewRemarkBlock
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function metadataKey(value: string): string {
  return compactWhitespace(value)
    .replace(/^证据[：:]\s*/, '')
    .replace(/[：:]/g, '：')
    .toLocaleLowerCase()
}

function uniqueValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (!value) continue
    const normalized = compactWhitespace(value)
    if (!normalized) continue
    const key = metadataKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }

  return result
}

function getLineValue(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`^${label}[：:][^\\S\\r\\n\\u2028\\u2029]*(.+)$`, 'm'))
  return match?.[1]?.trim()
}

function hasLine(text: string, label: string): boolean {
  return new RegExp(`^${label}[：:]`, 'm').test(text)
}

export function readMiaomiaoSuggestedOrder(value: unknown): BatchAiReviewItem['suggestedOrder'] {
  if (!value || typeof value !== 'object') return undefined
  const { code, type, orderedWords, chainDigest } = value as Record<string, unknown>
  if (typeof code !== 'string' || typeof type !== 'string'
    || typeof chainDigest !== 'string' || !/^[0-9a-f]{16}$/.test(chainDigest)
    || !Array.isArray(orderedWords) || orderedWords.length < 2 || orderedWords.length > 8) return undefined

  const words: unknown[] = Array.from(orderedWords)
  if (!words.every((word): word is string => typeof word === 'string' && word.length > 0 && !/[\r\n\u2028\u2029]/.test(word))
    || new Set(words).size !== words.length) return undefined
  return { code, type, orderedWords: words, chainDigest }
}

function parseSuggestedOrder(value?: string): BatchAiReviewItem['suggestedOrder'] {
  if (!value) return undefined
  try {
    return readMiaomiaoSuggestedOrder(JSON.parse(value))
  } catch {
    return undefined
  }
}

function splitSourceLabels(value: string): string[] {
  const labels: string[] = []
  let current = ''
  let parenthesisDepth = 0

  for (const character of value) {
    if (character === '(' || character === '（') {
      parenthesisDepth += 1
      current += character
      continue
    }
    if (character === ')' || character === '）') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1)
      current += character
      continue
    }
    if (parenthesisDepth === 0 && /[、,，;；]/.test(character)) {
      labels.push(current)
      current = ''
      continue
    }
    current += character
  }

  labels.push(current)
  return labels
}

export function getMiaomiaoSemanticEvidence(
  record: Pick<BatchAiReviewRecord, 'pronunciation' | 'sources' | 'evidence'>,
): string[] {
  const metadata = new Set<string>()
  if (record.pronunciation) {
    metadata.add(metadataKey(`读音：${record.pronunciation}`))
  }
  if (record.sources.length > 0) {
    metadata.add(metadataKey(`来源：${record.sources.join('、')}`))
  }

  return uniqueValues(record.evidence).filter(evidence => !metadata.has(metadataKey(evidence)))
}

export function getMiaomiaoEvidenceHighlights(
  record: Pick<BatchAiReviewRecord, 'pronunciation' | 'sources' | 'evidence'>,
): string[] {
  const pronunciation = record.pronunciation ? `读音：${record.pronunciation}` : undefined
  const source = record.sources.length > 0 ? `来源：${record.sources.join('、')}` : undefined

  return uniqueValues([
    pronunciation,
    ...getMiaomiaoSemanticEvidence(record),
    source,
  ])
}

export function parseMiaomiaoReviewRemark(remark?: string | null): ParsedMiaomiaoReviewRemark {
  if (!remark) return { baseRemark: '' }

  const matches = Array.from(remark.matchAll(MIAOMIAO_REVIEW_BLOCK_PATTERN))
  const latestBlock = matches.at(-1)?.[1]
  const baseRemark = remark.replace(MIAOMIAO_REVIEW_BLOCK_PATTERN, '').trim()
  if (!latestBlock) return { baseRemark }

  const pronunciation = getLineValue(latestBlock, '读音')
  const sources = uniqueValues(
    splitSourceLabels(getLineValue(latestBlock, '来源') || '')
      .map(source => source.trim()),
  )
  const rawEvidence = Array.from(latestBlock.matchAll(/^证据[：:][^\S\r\n\u2028\u2029]*(.+)$/gm))
    .map(match => match[1].trim())
    .filter(Boolean)
  const evidence = getMiaomiaoSemanticEvidence({ pronunciation, sources, evidence: rawEvidence })
  const daily = getLineValue(latestBlock, '常用')
  const authority = getLineValue(latestBlock, '收录')
  const suggestedOrder = parseSuggestedOrder(getLineValue(latestBlock, '排序'))

  return {
    baseRemark,
    review: {
      status: getLineValue(latestBlock, '本喵复审'),
      conclusion: getLineValue(latestBlock, '结论'),
      reason: getLineValue(latestBlock, '理由'),
      suggestion: getLineValue(latestBlock, '建议'),
      pronunciation,
      ...(daily || authority ? { commonness: { daily, authority } } : {}),
      ...(suggestedOrder ? { suggestedOrder } : {}),
      sources,
      hasSourcesField: hasLine(latestBlock, '来源'),
      evidence,
      generatedAt: getLineValue(latestBlock, '时间'),
      reviewDigest: getLineValue(latestBlock, '校验'),
    },
  }
}

export function stripMiaomiaoReviewRemark(remark?: string | null): string {
  return parseMiaomiaoReviewRemark(remark).baseRemark
}

/** Return each complete parser-recognised block with its bytes unchanged. */
export function extractMiaomiaoReviewBlocks(remark?: string | null): string[] {
  if (!remark) return []
  return Array.from(remark.matchAll(MIAOMIAO_REVIEW_BLOCK_EXACT_PATTERN), match => match[0])
}
