import { prisma } from '@/lib/prisma'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import type {
  BatchAiReviewChainEntry,
  BatchAiReviewCodeChain,
  BatchAiReviewItem,
  BatchAiReviewRecord,
  BatchAiReviewResult,
  BatchAiReviewSeverity,
  BatchAiReviewStatus,
} from '@/lib/types/batchAiReview'
import type { ConflictInfo } from './conflictDetector'

type PullRequestAction = 'Create' | 'Change' | 'Delete'

interface ReviewPullRequest {
  id: number
  action: PullRequestAction | string
  word: string | null
  oldWord?: string | null
  code: string | null
  type?: PhraseType | null
  weight: number | null
  remark: string | null
  hasConflict?: boolean
  conflictReason?: string | null
  conflictInfo?: ConflictInfo | null
  phrase?: {
    id: number
    word: string
    code: string
    type?: PhraseType | null
    weight?: number | null
  } | null
}

interface BuildBatchAiReviewInput {
  id: string
  status: string
  pullRequests: ReviewPullRequest[]
}

interface MovePair {
  word: string
  type: PhraseType
  fromCode: string
  toCode: string
  deletePrId: number
  createPrId: number
}

interface ParsedMiaomiaoReview {
  status: BatchAiReviewStatus
  severity: BatchAiReviewSeverity
  title: string
  reasons: string[]
  suggestions: string[]
  reviewRecord: BatchAiReviewRecord
}

const AUTHORITY_SOURCE_NAMES = [
  '汉典',
  '萌典',
  '百度百科',
  '维基百科',
  '现代汉语词典',
  '汉语大词典',
  '辞海',
  '国语辞典',
  '词典',
  '辞典',
]

const BOT_REVIEW_PATTERN = /(Bot审词|Bot 自动审词|喵喵审词|本喵|自动审词|喵喵|Miaomiao|Miao)/i
const MIAOMIAO_REVIEW_BLOCK_PATTERN = /--- miao-review:start ---([\s\S]*?)--- miao-review:end ---/g
const CHINESE_PATTERN = /[\u3400-\u9fff]/
const URL_PATTERN = /^https?:\/\//i
const ENGLISH_PATTERN = /^[A-Za-z][A-Za-z0-9 ._+\-'/]*$/
const CODE_PATTERN = /^[a-z]+$/

function normalizeType(type?: PhraseType | null): PhraseType {
  return (type || 'Phrase') as PhraseType
}

function getWord(pr: ReviewPullRequest): string {
  return pr.word || pr.phrase?.word || ''
}

function getCode(pr: ReviewPullRequest): string {
  return pr.code || pr.phrase?.code || ''
}

function chainKey(type: PhraseType, code: string): string {
  return `${type}:${code}`
}

function wordTypeKey(type: PhraseType, word: string): string {
  return `${type}:${word}`
}

function compactText(text: string, maxLength = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function formatEntry(entry: BatchAiReviewChainEntry): string {
  const weight = entry.weight === null ? '?' : entry.weight
  return `「${entry.word}」(${weight})`
}

function extractReviewRecord(remark: string | null): BatchAiReviewRecord | undefined {
  if (!remark) return undefined

  const normalized = remark.trim()
  const sourceNames = AUTHORITY_SOURCE_NAMES.filter(source => normalized.includes(source))
  const pronunciationMatch = normalized.match(/(?:读音|拼音)[：:\s]*([^；;，,。]+)/)
  const hasBotReview = BOT_REVIEW_PATTERN.test(normalized)
  const hasReviewEvidence = hasBotReview || sourceNames.length > 0 || Boolean(pronunciationMatch)

  if (!hasReviewEvidence) return undefined

  const evidence: string[] = []
  if (pronunciationMatch?.[1]) {
    evidence.push(`读音：${pronunciationMatch[1].trim()}`)
  }
  if (sourceNames.length > 0) {
    evidence.push(`来源：${sourceNames.join('、')}`)
  }
  if (hasBotReview) {
    evidence.push('来自喵喵审词备注')
  }

  return {
    reviewedBy: 'Miaomiao',
    source: 'bot-remark',
    summary: compactText(normalized),
    pronunciation: pronunciationMatch?.[1]?.trim(),
    sources: sourceNames,
    evidence,
  }
}

function getLineValue(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`^${label}[：:]\\s*(.+)$`, 'm'))
  return match?.[1]?.trim()
}

function parseMiaomiaoReviewStatus(value: string | undefined): BatchAiReviewStatus {
  const normalized = value || ''
  if (normalized.includes('通过')) return 'pass'
  if (normalized.includes('人工') || normalized.includes('不通过')) return 'manual_review'
  return 'attention'
}

function severityForStatus(status: BatchAiReviewStatus): BatchAiReviewSeverity {
  if (status === 'pass') return 'success'
  if (status === 'manual_review') return 'danger'
  return 'warning'
}

function parseMiaomiaoReviewRemark(remark: string | null): ParsedMiaomiaoReview | undefined {
  if (!remark) return undefined

  const blocks = Array.from(remark.matchAll(MIAOMIAO_REVIEW_BLOCK_PATTERN))
  const latestBlock = blocks.length > 0 ? blocks[blocks.length - 1]?.[1] : undefined
  if (!latestBlock) return undefined

  const status = parseMiaomiaoReviewStatus(getLineValue(latestBlock, '本喵复审'))
  const title = getLineValue(latestBlock, '结论') || (status === 'pass' ? '本喵建议通过' : '本喵建议复核')
  const reason = getLineValue(latestBlock, '理由')
  const suggestion = getLineValue(latestBlock, '建议')
  const pronunciation = getLineValue(latestBlock, '读音')
  const sources = (getLineValue(latestBlock, '来源') || '')
    .split(/[、,，]/)
    .map(source => source.trim())
    .filter(Boolean)
  const evidence = Array.from(latestBlock.matchAll(/^证据[：:]\s*(.+)$/gm))
    .map(match => match[1].trim())
    .filter(Boolean)

  if (pronunciation) {
    evidence.unshift(`读音：${pronunciation}`)
  }
  if (sources.length > 0) {
    evidence.push(`来源：${sources.join('、')}`)
  }

  return {
    status,
    severity: severityForStatus(status),
    title,
    reasons: reason ? [reason] : [title],
    suggestions: suggestion ? [suggestion] : ['按本喵复审结论处理；如有歧义，保留给管理员确认。'],
    reviewRecord: {
      reviewedBy: 'Miaomiao',
      source: 'bot-llm',
      summary: compactText(title),
      pronunciation,
      sources,
      evidence: evidence.length > 0 ? evidence : ['本喵已调用 LLM 完成复审。'],
    },
  }
}

function detectCodeMoves(prs: ReviewPullRequest[]): MovePair[] {
  const createsByWord = new Map<string, ReviewPullRequest[]>()
  const deletesByWord = new Map<string, ReviewPullRequest[]>()

  for (const pr of prs) {
    const word = getWord(pr)
    const code = getCode(pr)
    if (!word || !code) continue

    const key = wordTypeKey(normalizeType(pr.type), word)
    if (pr.action === 'Create') {
      if (!createsByWord.has(key)) createsByWord.set(key, [])
      createsByWord.get(key)!.push(pr)
    } else if (pr.action === 'Delete') {
      if (!deletesByWord.has(key)) deletesByWord.set(key, [])
      deletesByWord.get(key)!.push(pr)
    }
  }

  const moves: MovePair[] = []
  for (const [key, deletes] of deletesByWord) {
    const creates = createsByWord.get(key) || []
    const [, word] = key.split(':')
    for (const deletePr of deletes) {
      const fromCode = getCode(deletePr)
      const createPr = creates.find(candidate => getCode(candidate) && getCode(candidate) !== fromCode)
      if (!createPr) continue

      moves.push({
        word,
        type: normalizeType(deletePr.type),
        fromCode,
        toCode: getCode(createPr),
        deletePrId: deletePr.id,
        createPrId: createPr.id,
      })
    }
  }

  return moves
}

function findMoveForPr(moves: MovePair[], pr: ReviewPullRequest): MovePair | undefined {
  return moves.find(move => move.createPrId === pr.id || move.deletePrId === pr.id)
}

function addUnique(list: string[], value: string): void {
  if (!list.includes(value)) {
    list.push(value)
  }
}

function raiseStatus(
  current: { status: BatchAiReviewStatus; severity: BatchAiReviewSeverity },
  status: BatchAiReviewStatus,
  severity: BatchAiReviewSeverity
): void {
  const rank: Record<BatchAiReviewStatus, number> = {
    pass: 0,
    attention: 1,
    manual_review: 2,
  }
  if (rank[status] > rank[current.status]) {
    current.status = status
    current.severity = severity
  }
}

function collectLanguageChecks(pr: ReviewPullRequest, reasons: string[], suggestions: string[]): void {
  const word = getWord(pr)
  const code = getCode(pr)
  const type = normalizeType(pr.type)

  if (!word) {
    addUnique(reasons, '词条为空，无法判断读音、词性和编码。')
    addUnique(suggestions, '补充词条内容后再审核。')
    return
  }

  if (!code) {
    addUnique(reasons, '编码为空，无法进入词库。')
    addUnique(suggestions, '补充编码，或确认这是删除旧词条的操作。')
    return
  }

  if (!CODE_PATTERN.test(code) && type !== 'Symbol' && type !== 'Link') {
    addUnique(reasons, '编码包含非小写字母字符，和常规键道编码格式不一致。')
    addUnique(suggestions, '检查是否误把读音、标点或空格写入编码。')
  }

  if (word.length === 1 && type === 'Phrase') {
    addUnique(reasons, '这是单字，但当前类型是词组。')
    addUnique(suggestions, '如果它是常规单字，建议放入单字词库；若是特殊补充，请在审核意见中说明。')
  }

  if (word.length > 1 && (type === 'Single' || type === 'CSSSingle')) {
    addUnique(reasons, '这是多字词，但当前类型是单字类。')
    addUnique(suggestions, '确认是否应改为词组或声笔笔词条。')
  }

  if (type === 'English' && CHINESE_PATTERN.test(word)) {
    addUnique(reasons, '英文词库中包含中文字符。')
    addUnique(suggestions, '如果是中文词语，建议移到对应中文词库类型。')
  }

  if (type !== 'English' && type !== 'Link' && ENGLISH_PATTERN.test(word)) {
    addUnique(reasons, '非英文词库中出现纯英文内容。')
    addUnique(suggestions, '确认是否应放入英文词库。')
  }

  if (type === 'Link' && !URL_PATTERN.test(word)) {
    addUnique(reasons, '链接词库条目不像 URL。')
    addUnique(suggestions, '确认这是需要作为链接输出的内容。')
  }
}

function buildReviewItem(
  pr: ReviewPullRequest,
  moves: MovePair[]
): BatchAiReviewItem {
  const word = getWord(pr)
  const code = getCode(pr)
  const structuredReview = parseMiaomiaoReviewRemark(pr.remark)
  let reviewRecord = structuredReview?.reviewRecord ?? extractReviewRecord(pr.remark)
  const state = {
    status: 'pass' as BatchAiReviewStatus,
    severity: 'success' as BatchAiReviewSeverity,
  }
  const reasons: string[] = []
  const suggestions: string[] = []

  collectLanguageChecks(pr, reasons, suggestions)

  if (pr.conflictInfo?.hasConflict || pr.hasConflict) {
    raiseStatus(state, 'manual_review', 'danger')
    addUnique(reasons, pr.conflictInfo?.impact || pr.conflictReason || '冲突检测发现该条目需要人工确认。')
    addUnique(suggestions, '先处理冲突，再决定是否批准该批次。')
  } else if (pr.conflictInfo?.impact || pr.conflictReason) {
    raiseStatus(state, 'attention', 'warning')
    addUnique(reasons, pr.conflictInfo?.impact || pr.conflictReason || '存在需要关注的同码或多编码提示。')
    addUnique(suggestions, '确认这是否是有意保留的重码或多编码词。')
  }

  const move = findMoveForPr(moves, pr)
  if (pr.action === 'Delete') {
    if (move) {
      addUnique(reasons, `这是改码移动的一部分：${move.fromCode} → ${move.toCode}。`)
      addUnique(suggestions, '按改码处理，不视作纯删除；仍建议确认新编码读音和来源证据。')
    } else {
      raiseStatus(state, 'manual_review', 'danger')
      addUnique(reasons, '这是纯删除操作，自动审核不应直接通过。')
      addUnique(suggestions, '请管理员确认该词确实不应存在，或补成“删除旧编码 + 新增正确编码”的改码移动。')
    }
  }

  if (pr.action === 'Create') {
    if (move) {
      addUnique(reasons, `这是改码移动的新增侧：${move.fromCode} → ${move.toCode}。`)
      addUnique(suggestions, '确认新编码对应真实读音；如果同码链已有常用词，需看是否只是追加还是提频。')
    } else {
      addUnique(suggestions, '确认读音来源一致、编码由真实读音推出，并检查同码链顺序是否合理。')
    }
  }

  if (pr.action === 'Change') {
    raiseStatus(state, 'attention', 'warning')
    if (pr.oldWord && word) {
      addUnique(reasons, `改词会把「${pr.oldWord}」改为「${word}」。`)
      addUnique(suggestions, '如果两个词都能独立成词，优先考虑新增正确词，而不是覆盖旧词。')
      addUnique(suggestions, '如果是纠错，请在审核意见里写明旧词为什么错，并尽量引用来源。')
    } else {
      addUnique(reasons, '改词操作缺少旧词或新词信息。')
      addUnique(suggestions, '补齐原词和目标词后再审核。')
    }
  }

  if (!reviewRecord && pr.action !== 'Delete') {
    raiseStatus(state, 'attention', 'warning')
    addUnique(reasons, '未看到喵喵复审记录、读音来源或常用词语言常识判断。')
    addUnique(suggestions, '建议点击“让喵再审”，由喵结合 LLM、词典来源和现代汉语常识判断；常见成语或熟语不必强制要求词典来源。')
  }

  if (reviewRecord && reviewRecord.sources.length === 0 && pr.action !== 'Delete') {
    raiseStatus(state, 'attention', 'warning')
    addUnique(reasons, '有喵喵审词记录，但没有识别到来源名称或常识判断说明。')
    addUnique(suggestions, '若是大众已知的常见词、成语或熟语，可由喵在复审理由中写明读音、含义和语言常识依据。')
  }

  if (reviewRecord && !reviewRecord.pronunciation && pr.action !== 'Delete') {
    raiseStatus(state, 'attention', 'warning')
    addUnique(reasons, '有喵喵审词记录，但没有识别到读音字段。')
    addUnique(suggestions, '补充读音，避免把多音词按错误读音编码。')
  }

  if (structuredReview) {
    state.status = structuredReview.status
    state.severity = structuredReview.severity
    reviewRecord = structuredReview.reviewRecord
    reasons.splice(0, reasons.length, ...structuredReview.reasons)
    suggestions.splice(0, suggestions.length, ...structuredReview.suggestions)

    const moveAfterStructuredReview = findMoveForPr(moves, pr)
    if (pr.action === 'Delete' && !moveAfterStructuredReview) {
      raiseStatus(state, 'manual_review', 'danger')
      addUnique(reasons, '这是纯删除操作，需要管理员确认。')
      addUnique(suggestions, '确认该词确实不应存在；若是改码，请补齐新增侧。')
    }
    if (pr.conflictInfo?.hasConflict || pr.hasConflict) {
      raiseStatus(state, 'manual_review', 'danger')
      addUnique(reasons, pr.conflictInfo?.impact || pr.conflictReason || '冲突检测发现该条目需要人工确认。')
      addUnique(suggestions, '先处理冲突，再决定是否批准该批次。')
    }
  }

  const title = (() => {
    if (structuredReview) return structuredReview.title
    if (!reviewRecord && pr.action !== 'Delete') return '缺少喵备注'
    if (state.status === 'manual_review') return '需要管理员确认'
    if (state.status === 'attention' && reviewRecord) return '喵备注需补证据'
    if (state.status === 'attention') return '建议复核'
    if (reviewRecord) return '喵喵已审'
    return '系统检查未发现硬性问题'
  })()

  return {
    prId: pr.id,
    status: state.status,
    severity: state.severity,
    title,
    reasons: reasons.length > 0 ? reasons : [`「${word}」@${code} 未发现明显冲突。`],
    suggestions: suggestions.length > 0 ? suggestions : ['可结合编码链位置做最终确认。'],
    reviewRecord,
  }
}

async function buildCodeChains(prs: ReviewPullRequest[], moves: MovePair[]): Promise<BatchAiReviewCodeChain[]> {
  const affectedGroups = new Map<string, { type: PhraseType; code: string }>()
  for (const pr of prs) {
    const code = getCode(pr)
    if (!code) continue
    const type = normalizeType(pr.type)
    affectedGroups.set(chainKey(type, code), { type, code })
  }

  if (affectedGroups.size === 0) return []

  const where = Array.from(affectedGroups.values()).map(group => ({
    code: group.code,
    type: group.type,
    status: 'Finish' as const,
  }))

  const currentPhrases = await prisma.phrase.findMany({
    where: { OR: where },
    select: {
      id: true,
      word: true,
      code: true,
      type: true,
      weight: true,
    },
    orderBy: [
      { type: 'asc' },
      { code: 'asc' },
      { weight: 'asc' },
      { id: 'asc' },
    ],
  })

  const chains = new Map<string, BatchAiReviewChainEntry[]>()
  for (const group of affectedGroups.values()) {
    chains.set(chainKey(group.type, group.code), [])
  }

  for (const phrase of currentPhrases) {
    const type = normalizeType(phrase.type)
    const key = chainKey(type, phrase.code)
    chains.get(key)?.push({
      word: phrase.word,
      code: phrase.code,
      type,
      weight: phrase.weight,
      source: 'current',
    })
  }

  const result: BatchAiReviewCodeChain[] = []

  for (const group of affectedGroups.values()) {
    const key = chainKey(group.type, group.code)
    const before = [...(chains.get(key) || [])].sort(compareChainEntry)
    const after = before.map(entry => ({ ...entry }))

    for (const pr of prs) {
      const prCode = getCode(pr)
      const prType = normalizeType(pr.type)
      if (prCode !== group.code || prType !== group.type) continue

      const word = getWord(pr)
      if (!word) continue

      if (pr.action === 'Delete') {
        const index = after.findIndex(entry => entry.word === word && entry.code === prCode)
        if (index >= 0) after.splice(index, 1)
      } else if (pr.action === 'Change') {
        const oldWord = pr.oldWord || pr.phrase?.word
        const index = oldWord
          ? after.findIndex(entry => entry.word === oldWord && entry.code === prCode)
          : -1
        if (index >= 0) {
          after[index] = {
            ...after[index],
            word,
            weight: pr.weight ?? after[index].weight,
            source: 'draft',
            action: pr.action,
            prId: pr.id,
          }
        } else {
          after.push({
            word,
            code: prCode,
            type: prType,
            weight: pr.weight ?? nextWeight(after),
            source: 'draft',
            action: pr.action,
            prId: pr.id,
          })
        }
      } else if (pr.action === 'Create') {
        const exists = after.some(entry => entry.word === word && entry.code === prCode)
        if (!exists) {
          after.push({
            word,
            code: prCode,
            type: prType,
            weight: pr.weight ?? nextWeight(after),
            source: 'draft',
            action: pr.action,
            prId: pr.id,
          })
        }
      }
    }

    after.sort(compareChainEntry)

    result.push({
      code: group.code,
      type: group.type,
      before,
      after,
      recommendations: buildChainRecommendations(group.code, before, after, moves),
    })
  }

  return result
}

function compareChainEntry(a: BatchAiReviewChainEntry, b: BatchAiReviewChainEntry): number {
  const weightA = a.weight ?? Number.MAX_SAFE_INTEGER
  const weightB = b.weight ?? Number.MAX_SAFE_INTEGER
  if (weightA !== weightB) return weightA - weightB
  return a.word.localeCompare(b.word, 'zh-Hans-CN')
}

function nextWeight(entries: BatchAiReviewChainEntry[]): number {
  const weights = entries.map(entry => entry.weight).filter((weight): weight is number => typeof weight === 'number')
  if (weights.length === 0) return 100
  return Math.max(...weights) + 1
}

function buildChainRecommendations(
  code: string,
  before: BatchAiReviewChainEntry[],
  after: BatchAiReviewChainEntry[],
  moves: MovePair[]
): string[] {
  const recommendations: string[] = []
  const beforeWords = new Set(before.map(entry => entry.word))
  const afterWords = new Set(after.map(entry => entry.word))
  const added = after.filter(entry => entry.source === 'draft' || !beforeWords.has(entry.word))
  const removed = before.filter(entry => !afterWords.has(entry.word))
  const firstBefore = before[0]
  const firstAfter = after[0]

  const relatedMoves = moves.filter(move => move.fromCode === code || move.toCode === code)
  for (const move of relatedMoves) {
    const direction = move.toCode === code ? '移入' : '移出'
    recommendations.push(`「${move.word}」${direction}该编码链：${move.fromCode} → ${move.toCode}。`)
  }

  if (before.length === 0 && after.length > 0) {
    recommendations.push(`编码 ${code} 原本为空，新增后首位是 ${formatEntry(after[0])}。`)
  }

  if (firstBefore && firstAfter && firstBefore.word !== firstAfter.word) {
    recommendations.push(`首位将从 ${formatEntry(firstBefore)} 变为 ${formatEntry(firstAfter)}，需要确认新首位确实更常用或更符合编码目标。`)
  }

  for (const entry of added) {
    const index = after.findIndex(item => item.word === entry.word && item.prId === entry.prId)
    if (index > 0) {
      recommendations.push(`新增 ${formatEntry(entry)} 位于第 ${index + 1} 位，前面还有 ${formatEntry(after[index - 1])}；如果目标是提频，需要常用度证据。`)
    } else if (after.length > 1) {
      recommendations.push(`新增 ${formatEntry(entry)} 将处在首位，请确认它比后续同码词更常用。`)
    }
  }

  for (const entry of removed) {
    recommendations.push(`将移除 ${formatEntry(entry)}；如果不是改码移动，应由管理员明确确认删除理由。`)
  }

  if (after.length > 1) {
    recommendations.push(`建议顺序：${after.slice(0, 5).map(formatEntry).join(' > ')}${after.length > 5 ? ' > ...' : ''}。`)
  }

  if (recommendations.length === 0) {
    recommendations.push(`编码 ${code} 的同码链未出现明显优先级变化。`)
  }

  return recommendations
}

function buildChecklist(items: BatchAiReviewItem[], codeChains: BatchAiReviewCodeChain[]): string[] {
  const checklist = [
    '已检查批次内冲突、数据库重码、多编码和动态权重。',
    '已识别喵喵写入的读音、来源或常用词语言常识备注，并标注证据缺口。',
    '已把纯删除和改码移动区分开，纯删除保留给管理员确认。',
    '已检查改词操作是否可能覆盖仍然有效的原词。',
    '已生成受影响编码链的前后顺序和优先级建议。',
  ]

  const missingEvidenceCount = items.filter(item =>
    item.reasons.some(reason => reason.includes('未看到喵喵复审') || reason.includes('未看到 bot 写入') || reason.includes('没有识别到'))
  ).length
  if (missingEvidenceCount > 0) {
    checklist.push(`有 ${missingEvidenceCount} 个条目缺少完整读音或来源证据。`)
  }

  const chainRiskCount = codeChains.filter(chain =>
    chain.recommendations.some(recommendation => recommendation.includes('首位将从') || recommendation.includes('提频'))
  ).length
  if (chainRiskCount > 0) {
    checklist.push(`有 ${chainRiskCount} 条编码链涉及首位或提频判断，建议重点查看。`)
  }

  return checklist
}

function buildSuggestedReviewNote(items: BatchAiReviewItem[], codeChains: BatchAiReviewCodeChain[]): string {
  const manualItems = items.filter(item => item.status === 'manual_review')
  const attentionItems = items.filter(item => item.status === 'attention')
  const botReviewedItems = items.filter(item => item.reviewRecord)
  const chainNotes = codeChains
    .flatMap(chain => chain.recommendations.map(recommendation => `${chain.code}: ${recommendation}`))
    .slice(0, 4)

  const lines = ['喵喵审核建议：']
  if (manualItems.length > 0) {
    lines.push(`需管理员确认 ${manualItems.length} 项：${manualItems.map(item => `PR#${item.prId}`).join('、')}。`)
  } else if (attentionItems.length > 0) {
    lines.push(`建议复核后通过，需关注 ${attentionItems.length} 项：${attentionItems.map(item => `PR#${item.prId}`).join('、')}。`)
  } else {
    lines.push('未发现硬性冲突，喵喵审词证据与编码检查整体可接受。')
  }

  if (botReviewedItems.length > 0) {
    lines.push(`已识别 ${botReviewedItems.length} 项喵喵审词记录。`)
  }

  if (chainNotes.length > 0) {
    lines.push('编码链建议：')
    for (const note of chainNotes) {
      lines.push(`- ${note}`)
    }
  }

  return lines.join('\n')
}

function buildHeadline(items: BatchAiReviewItem[]): string {
  const manualCount = items.filter(item => item.status === 'manual_review').length
  const attentionCount = items.filter(item => item.status === 'attention').length
  const passCount = items.filter(item => item.status === 'pass').length

  if (manualCount > 0) {
    return `${manualCount} 项必须人工确认，先看下方风险列表。`
  }
  if (attentionCount > 0) {
    return `${attentionCount} 项需要复核，其他 ${passCount} 项未见硬性问题。`
  }
  return `${passCount} 项已通过喵喵检查，可进入批准流程。`
}

export async function buildBatchAiReview(batch: BuildBatchAiReviewInput): Promise<BatchAiReviewResult> {
  const moves = detectCodeMoves(batch.pullRequests)
  const items = batch.pullRequests.map(pr => buildReviewItem(pr, moves))
  const codeChains = await buildCodeChains(batch.pullRequests, moves)

  const manualReview = items.filter(item => item.status === 'manual_review').length
  const attention = items.filter(item => item.status === 'attention').length
  const pass = items.filter(item => item.status === 'pass').length
  const botReviewed = items.filter(item => item.reviewRecord).length
  const verdict = manualReview > 0 ? 'manual_review' : attention > 0 ? 'needs_attention' : 'pass'

  return {
    reviewer: 'Miaomiao',
    generatedAt: new Date().toISOString(),
    verdict,
    headline: buildHeadline(items),
    suggestedReviewNote: buildSuggestedReviewNote(items, codeChains),
    riskCounts: {
      pass,
      attention,
      manualReview,
      botReviewed,
    },
    checklist: buildChecklist(items, codeChains),
    items,
    codeChains,
  }
}
