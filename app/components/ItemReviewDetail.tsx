'use client'

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Tooltip } from '@heroui/react'
import { Chip, Popover, PopoverContent, PopoverTrigger } from '@/lib/heroui-compat'
import { AlertTriangle, Bot, ChevronRight, History, MessageSquareText } from 'lucide-react'
import { getPhraseTypeLabel, type PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewItem } from '@/lib/types/batchAiReview'
import type { BatchReviewTier } from '@/lib/services/batchAiReviewService'
import { parseMiaomiaoReviewRemark, stripLegacyBotReviewText } from '@/lib/services/miaomiaoReviewRemark'
import { BatchItemVoteCounts } from './BatchItemVote'
import { MiaomiaoDiffReview } from './BatchPreview'
import CodePhrasesPopover from './CodePhrasesPopover'

export interface ItemReviewDetailItem {
  id: number
  word: string | null
  oldWord?: string | null
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
  status: 'Pending' | 'Approved' | 'Rejected'
  type?: PhraseType | null
  weight: number | null
  remark: string | null
  hasConflict: boolean
  conflictReason: string | null
  conflictInfo?: { hasConflict: boolean; impact?: string }
  phrase?: { word: string; code: string }
  aiReview?: BatchAiReviewItem & { tier?: BatchReviewTier }
  _count?: { likedBy: number; dislikedBy: number }
  reviewNotes?: Array<{
    id: number
    decision: 'Approved' | 'Rejected'
    reason: string
    createdAt: string
    reviewer?: { name: string; nickname?: string | null } | null
  }>
  dependencies: Array<{ dependsOn: { id: number; word: string | null }; reason?: string }>
  dependedBy?: Array<{ dependent: { id: number; word: string | null }; reason?: string }>
}

const decisionLabels = { Approved: '同意', Rejected: '拒绝' }
const reviewTierLabels = { manual: '需人工', look: '需查看', safe: '可放行' }

const reviewItemActions = {
  Create: { label: '新增', color: 'success' },
  Change: { label: '修改', color: 'warning' },
  Delete: { label: '删除', color: 'danger' },
} as const

export default function ItemReviewDetail({ item, reviewing = false, waitingOnDependencies, actions, rejectedReason,
  publicView = false, hideMiaomiaoReview = false }: {
  item: ItemReviewDetailItem
  reviewing?: boolean
  publicView?: boolean
  hideMiaomiaoReview?: boolean
  waitingOnDependencies: boolean
  actions: ReactNode
  rejectedReason?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const detailId = useId()
  const { conflictInfo } = item
  const aiReview = hideMiaomiaoReview ? undefined : item.aiReview
  const tier = aiReview?.tier ?? 'look'
  const hasConflict = publicView ? conflictInfo?.hasConflict ?? item.hasConflict : conflictInfo?.hasConflict || item.hasConflict
  const conflictReason = conflictInfo?.impact || item.conflictReason
  const aiNotice = aiReview && aiReview.status !== 'pass' ? aiReview : undefined
  const status = item.status === 'Pending' ? '待审核' : item.status === 'Rejected' ? '已拒绝' :
    waitingOnDependencies ? '已同意，等待依赖处理' : '已同意'
  const statusColor = item.status === 'Pending' ? 'default' : item.status === 'Rejected' ? 'danger' :
    waitingOnDependencies ? 'warning' : 'success'
  const word = item.word || item.phrase?.word || ''
  const code = item.code || item.phrase?.code || ''
  const remark = parseMiaomiaoReviewRemark(item.remark)
  const baseRemark = stripLegacyBotReviewText(remark)
  const review = hideMiaomiaoReview ? undefined : remark.review
  const reviewSummary = !review ? aiReview?.reviewRecord?.summary : undefined
  const reviewText = new Set([review?.conclusion, review?.reason, review?.suggestion])
  const ruleTitle = aiNotice && !reviewText.has(aiNotice.title) ? aiNotice.title : undefined
  const ruleReasons = aiNotice?.reasons.filter(reason => !reviewText.has(reason)).slice(0, 2) ?? []
  const ruleSuggestion = aiNotice?.suggestions.find(suggestion => !reviewText.has(suggestion))
  const action = reviewItemActions[item.action]
  const notes = item.reviewNotes ?? []
  const noteList = notes.length > 0 && (
    <ol className="space-y-2" aria-label="词条审核记录">
      {notes.map(note => (
        <li key={note.id}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{decisionLabels[note.decision]} · {note.reviewer?.nickname || note.reviewer?.name || '审核员'}</span>
            {!publicView && <time className="text-default-500" dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString('zh-CN')}</time>}
          </div>
          {note.reason && !(publicView && note.reason === rejectedReason) && (
            <p className="whitespace-pre-wrap break-words">{note.reason}</p>
          )}
        </li>
      ))}
    </ol>
  )

  return (
    <>
      <div className="flex min-h-8 min-w-0 items-center gap-2 text-xs max-sm:flex-wrap">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:whitespace-nowrap max-sm:basis-full">
          <button type="button" aria-expanded={expanded} aria-controls={detailId} aria-label="词条详情"
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-default-500/20 max-lg:pointer-coarse:size-11"
            onClick={() => setExpanded(value => !value)}>
            <ChevronRight className={`size-4 ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
          <span className="tabular-nums">#{item.id}</span>
          <Chip size="sm" variant="flat" color={action.color}>{action.label}</Chip>
          {item.type && <Chip size="sm" variant="flat">{getPhraseTypeLabel(item.type)}</Chip>}
          {item.action === 'Change' && item.oldWord && (
            <>
              <del className="min-w-0 max-w-32 truncate opacity-75 max-sm:max-w-full max-sm:whitespace-normal max-sm:wrap-anywhere" title={item.oldWord}>{item.oldWord}</del>
              <span aria-hidden="true">→</span>
            </>
          )}
          <span className="min-w-0 max-w-40 truncate font-semibold max-sm:max-w-full max-sm:whitespace-normal max-sm:wrap-anywhere" title={word}>{word}</span>
          {code && (
            <span className="min-w-0 max-w-full *:max-w-full sm:max-w-32">
              <CodePhrasesPopover code={code}>
                <code title={code} className="block cursor-pointer truncate underline decoration-dotted underline-offset-2 max-sm:whitespace-normal max-sm:wrap-anywhere">{code}</code>
              </CodePhrasesPopover>
            </span>
          )}
          <Link href={`/phrases/history?${new URLSearchParams({ word: item.oldWord || word, code })}`}
            aria-label="词条修改历史" title="词条修改历史" className="rounded-md p-1.5 hover:bg-default-500/20 max-lg:pointer-coarse:grid max-lg:pointer-coarse:size-11 max-lg:pointer-coarse:shrink-0 max-lg:pointer-coarse:place-items-center">
            <History className="size-4" aria-hidden="true" />
          </Link>
          {publicView ? (
            <span className="w-16 shrink-0">
              {aiNotice && <Chip size="sm" variant="flat" color={aiNotice.status === 'manual_review' ? 'danger' : 'warning'}>
                {aiNotice.status === 'manual_review' ? '人工' : '待看'}
              </Chip>}
            </span>
          ) : (
            <Chip size="sm" variant="flat" color={tier === 'manual' ? 'danger' : tier === 'safe' ? 'success' : 'warning'}>
              {reviewTierLabels[tier]}
            </Chip>
          )}
          <span className="grid w-[12em] shrink-0 justify-items-start">
            <Chip size="sm" variant="flat" color={statusColor}>{status}</Chip>
          </span>
          <span className="w-14 shrink-0">
            {reviewSummary && (
              <Tooltip isOpen={summaryOpen} onOpenChange={setSummaryOpen} shouldCloseOnPress={false}>
                <Tooltip.Trigger<'button'> render={props => <button {...props} type="button" />}
                  className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-primary"
                  onFocus={() => setSummaryOpen(true)} onBlur={() => setSummaryOpen(false)}
                  onClick={event => {
                    event.currentTarget.focus({ preventScroll: true })
                    setSummaryOpen(true)
                  }}>
                  <Chip size="sm" variant="flat" color="primary" startContent={<Bot className="size-3" aria-hidden="true" />}>喵审</Chip>
                </Tooltip.Trigger>
                <Tooltip.Content className="max-w-xs whitespace-pre-wrap break-words">{reviewSummary}</Tooltip.Content>
              </Tooltip>
            )}
          </span>
          <Chip size="sm" variant="flat" color="warning" className={`max-sm:hidden ${hasConflict ? '' : 'invisible'}`}
            startContent={<AlertTriangle className="size-3" aria-hidden="true" />}>冲突</Chip>
          <button type="button" aria-expanded={expanded} aria-controls={detailId} aria-label="冲突详情"
            className={`grid h-7 w-14 shrink-0 place-items-center sm:hidden ${hasConflict && conflictReason ? 'cursor-pointer' : hasConflict ? '' : 'invisible'}`}
            disabled={!conflictReason} onClick={() => setExpanded(value => !value)}>
            <Chip size="sm" variant="flat" color="warning" startContent={<AlertTriangle className="size-3" aria-hidden="true" />}>冲突</Chip>
          </button>
          {reviewing && notes.length > 0 ? (
            <Popover placement="top">
              <PopoverTrigger className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-default-500/20 max-lg:pointer-coarse:size-11"
                aria-label="词条审核记录" title="词条审核记录">
                <MessageSquareText className="size-4" aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent aria-label="词条审核记录" className="max-h-72 max-w-xs overflow-auto p-3 text-small">
                {noteList}
              </PopoverContent>
            </Popover>
          ) : !publicView && <span className="size-7 shrink-0 max-lg:pointer-coarse:size-11" aria-hidden="true" />}
          {!publicView && <span className="min-w-[4.5rem] shrink-0">
            {item._count && <BatchItemVoteCounts likes={item._count.likedBy} dislikes={item._count.dislikedBy} />}
          </span>}
        </div>
        <div className="ml-auto shrink-0 self-start max-sm:ml-0 max-sm:w-full">{actions}</div>
      </div>
      {publicView && rejectedReason && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-warning">拒绝原因：{rejectedReason}</p>}
      {review && <MiaomiaoDiffReview review={review} />}
      {baseRemark && <p className="mt-1 whitespace-pre-wrap break-words text-xs opacity-75">{baseRemark}</p>}
      <div id={detailId} hidden={!expanded}
        className="mt-1 h-48 w-full max-w-xl space-y-2 overflow-auto break-words rounded-md bg-content1 px-3 py-2 text-small text-foreground">
        {expanded && (
          <>
            {item.weight != null && <p>权重：{item.weight}</p>}
            {aiReview?.referenceEvidence && <p className="whitespace-pre-wrap text-default-600">{aiReview.referenceEvidence.line}</p>}
            {(ruleTitle || ruleReasons.length > 0 || ruleSuggestion) && (
              <div className="space-y-1">
                {ruleTitle && <p className="font-medium">{ruleTitle}</p>}
                {ruleReasons.map((reason, index) => <p key={index}>{reason}</p>)}
                {ruleSuggestion && <p>建议：{ruleSuggestion}</p>}
              </div>
            )}
            {conflictReason && <p className="text-warning">{conflictReason}</p>}
            {!publicView && rejectedReason && <p className="text-warning">拒绝原因：{rejectedReason}</p>}
            {item.dependencies.length > 0 && (
              <div>
                <p className="font-medium">依赖于</p>
                <ul>{item.dependencies.map(({ dependsOn, reason }) => (
                  <li key={dependsOn.id}>#{dependsOn.id} {dependsOn.word} {reason}</li>
                ))}</ul>
              </div>
            )}
            {!!item.dependedBy?.length && (
              <div>
                <p className="font-medium">被依赖</p>
                <ul>{item.dependedBy.map(({ dependent, reason }) => (
                  <li key={dependent.id}>#{dependent.id} {dependent.word} {reason}</li>
                ))}</ul>
              </div>
            )}
            {publicView && waitingOnDependencies && <p className="text-warning-700">关联词条尚未完成审核</p>}
            {!reviewing && noteList}
          </>
        )}
      </div>
    </>
  )
}
