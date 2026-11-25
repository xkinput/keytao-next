import type { BatchAiReviewItem, BatchAiReviewPriority, BatchAiReviewRecord } from '@/lib/types/batchAiReview'

export const MIAOMIAO_REVIEW_BLOCK_START = '--- miao-review:start ---'
export const MIAOMIAO_REVIEW_BLOCK_END = '--- miao-review:end ---'
export const MIAOMIAO_PRIORITY_LABELS = { high: '高', medium: '中', low: '低' } as const

const MIAOMIAO_REVIEW_BLOCK_SOURCE = `${MIAOMIAO_REVIEW_BLOCK_START}([\\s\\S]*?)${MIAOMIAO_REVIEW_BLOCK_END}`
const MIAOMIAO_REVIEW_BLOCK_PATTERN = new RegExp(`\\n?${MIAOMIAO_REVIEW_BLOCK_SOURCE}`, 'g')
const MIAOMIAO_REVIEW_BLOCK_EXACT_PATTERN = new RegExp(MIAOMIAO_REVIEW_BLOCK_SOURCE, 'g')

export interface MiaomiaoReviewRemarkBlock {
  status?: string
  priority?: BatchAiReviewPriority
  priorityReason?: string
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

function cardEvidenceKey(value: string): string {
  return metadataKey(value)
    .replace(/^(?:本喵)?语言常识：\s*/, '')
    .replace(/[。.!！；;]+$/, '')
}

export function getMiaomiaoCardEvidence(review: MiaomiaoReviewRemarkBlock) {
  const displayed = [review.conclusion, review.reason, review.suggestion, review.pronunciation,
    review.commonness?.daily, review.commonness?.authority].flatMap(value => value ? [value] : [])
  const seen = new Set(displayed.flatMap(value => [value, ...value.split(/[；;]/)]).map(cardEvidenceKey))
  const sourceFields = new Set(review.sources.map(source => metadataKey(`来源：${source}`)))
  const evidence = review.evidence.filter(line => {
    const key = cardEvidenceKey(line)
    if (!key || seen.has(key) || sourceFields.has(metadataKey(line))) return false
    seen.add(key)
    return true
  })
  const text = [...displayed, ...evidence].map(metadataKey)
  const sources = review.sources.filter(source => !text.some(line => line.includes(metadataKey(source))))
  return { evidence, sources }
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
  const priorityLine = getLineValue(latestBlock, '优先级')?.match(/^([高中低])(?:（(.*)）|\((.*)\))?$/)
  const priority = (['high', 'medium', 'low'] as const).find(value => MIAOMIAO_PRIORITY_LABELS[value] === priorityLine?.[1])
  const priorityReason = (priorityLine?.[2] ?? priorityLine?.[3])?.trim()

  return {
    baseRemark,
    review: {
      status: getLineValue(latestBlock, '本喵复审'),
      ...(priority ? { priority, priorityReason: priorityReason || undefined } : {}),
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

export function stripLegacyBotReviewText({ baseRemark, review }: ParsedMiaomiaoReviewRemark): string {
  if (!review) return baseRemark

  let afterBotHeader = false
  let continuedFields = false
  return baseRemark.split(/\r\n|[\r\n\u2028\u2029]/).filter(line => {
    const text = line.trim()
    const header = text.match(/^喵喵审词[：:](.*)$/)
    if (header) {
      afterBotHeader = true
      continuedFields = !header[1].trim()
      return false
    }
    if (continuedFields && /^(?:读音|拼音|来源|证据|自动审核)[：:\s]/.test(text)) return false
    if (text) continuedFields = false
    // shortcut: Unrecognised lines may be author text; add patterns when the bot's format is known.
    return !afterBotHeader || !/^(?:本喵(?:已|认为|建议|判断)|存在不确定项|「[^」]+」\s*(?:读音由|较\s*「[^」]+」\s*更常用))/.test(text)
  }).join('\n').trim()
}

export function stripMiaomiaoReviewRemark(remark?: string | null): string {
  return parseMiaomiaoReviewRemark(remark).baseRemark
}

/** Return each complete parser-recognised block with its bytes unchanged. */
export function extractMiaomiaoReviewBlocks(remark?: string | null): string[] {
  if (!remark) return []
  return Array.from(remark.matchAll(MIAOMIAO_REVIEW_BLOCK_EXACT_PATTERN), match => match[0])
}

export function rewriteMiaomiaoOrderRemark(
  remark: string | null,
  slot: { code: string; type: string },
  digest?: { before: string; after: string } | 'remove',
): string | null {
  if (!remark) return remark
  const latest = Array.from(remark.matchAll(MIAOMIAO_REVIEW_BLOCK_EXACT_PATTERN)).at(-1)?.index
  return remark.replace(MIAOMIAO_REVIEW_BLOCK_EXACT_PATTERN, (_match, block: string, offset: number) => {
    let next = block.replace(/^排序[：:]([^\r\n\u2028\u2029]*)(?:\r\n|[\r\n\u2028\u2029]|$)/gm, (line, value: string) => {
      const order = parseSuggestedOrder(value)
      return order?.code === slot.code && order.type === slot.type ? '' : line
    })
    if (digest === 'remove') {
      next = next.replace(/^校验[：:][^\r\n\u2028\u2029]*(?:\r\n|[\r\n\u2028\u2029]|$)/gm, '')
    } else if (offset === latest && digest) {
      const previous = getLineValue(block, '校验')
      if (previous === digest.before || previous === digest.after) {
        // A stale digest can coincide with the new weight after reverting to an older order.
        next = next.replace(/^校验[：:][^\r\n\u2028\u2029]*(\r\n|[\r\n\u2028\u2029]|$)/gm,
          (_line, ending: string) => previous === digest.before ? `校验：${digest.after}${ending}` : '')
      }
    }
    return MIAOMIAO_REVIEW_BLOCK_START + next + MIAOMIAO_REVIEW_BLOCK_END
  })
}
