import type { BatchAiReviewRecord } from '@/lib/types/batchAiReview'

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
  sources: string[]
  hasSourcesField: boolean
  evidence: string[]
  generatedAt?: string
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
  const match = text.match(new RegExp(`^${label}[：:][^\\S\\r\\n]*(.+)$`, 'm'))
  return match?.[1]?.trim()
}

function hasLine(text: string, label: string): boolean {
  return new RegExp(`^${label}[：:]`, 'm').test(text)
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
  const rawEvidence = Array.from(latestBlock.matchAll(/^证据[：:]\s*(.+)$/gm))
    .map(match => match[1].trim())
    .filter(Boolean)
  const evidence = getMiaomiaoSemanticEvidence({ pronunciation, sources, evidence: rawEvidence })

  return {
    baseRemark,
    review: {
      status: getLineValue(latestBlock, '本喵复审'),
      conclusion: getLineValue(latestBlock, '结论'),
      reason: getLineValue(latestBlock, '理由'),
      suggestion: getLineValue(latestBlock, '建议'),
      pronunciation,
      sources,
      hasSourcesField: hasLine(latestBlock, '来源'),
      evidence,
      generatedAt: getLineValue(latestBlock, '时间'),
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
