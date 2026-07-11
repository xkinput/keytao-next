import type { BatchAiReviewRecord } from '@/lib/types/batchAiReview'

const MIAOMIAO_REVIEW_BLOCK_PATTERN = /\n?--- miao-review:start ---([\s\S]*?)--- miao-review:end ---/g

export interface MiaomiaoReviewRemarkBlock {
  status?: string
  conclusion?: string
  reason?: string
  suggestion?: string
  pronunciation?: string
  sources: string[]
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
  const match = text.match(new RegExp(`^${label}[：:]\\s*(.+)$`, 'm'))
  return match?.[1]?.trim()
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
    (getLineValue(latestBlock, '来源') || '')
      .split(/[、,，]/)
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
      evidence,
      generatedAt: getLineValue(latestBlock, '时间'),
    },
  }
}

export function stripMiaomiaoReviewRemark(remark?: string | null): string {
  return parseMiaomiaoReviewRemark(remark).baseRemark
}
