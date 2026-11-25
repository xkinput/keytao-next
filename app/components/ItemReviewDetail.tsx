'use client'

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Chip, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/lib/heroui-compat'
import { AlertTriangle, Bot, ChevronRight, History, MessageSquareText } from 'lucide-react'
import { getPhraseTypeLabel, type PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewItem } from '@/lib/types/batchAiReview'
import type { BatchReviewTier } from '@/lib/services/batchAiReviewService'
import { getMiaomiaoEvidenceHighlights, parseMiaomiaoReviewRemark } from '@/lib/services/miaomiaoReviewRemark'
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

export default function ItemReviewDetail({ item, reviewing = false, waitingOnDependencies, actions, rejectedReason, publicView = false }: {
  item: ItemReviewDetailItem
  reviewing?: boolean
  publicView?: boolean
  waitingOnDependencies: boolean
  actions: ReactNode
  rejectedReason?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const { aiReview, conflictInfo } = item
  const tier = aiReview?.tier ?? 'look'
  const hasConflict = publicView ? conflictInfo?.hasConflict ?? item.hasConflict : conflictInfo?.hasConflict || item.hasConflict
  const aiNotice = aiReview && aiReview.status !== 'pass' ? aiReview : undefined
  const status = item.status === 'Pending' ? '待审核' : item.status === 'Rejected' ? '已拒绝' :
    waitingOnDependencies ? '已同意，等待依赖处理' : '已同意'
  const statusColor = item.status === 'Pending' ? 'default' : item.status === 'Rejected' ? 'danger' :
    waitingOnDependencies ? 'warning' : 'success'
  const word = item.word || item.phrase?.word || ''
  const code = item.code || item.phrase?.code || ''
  const remark = expanded && !publicView ? parseMiaomiaoReviewRemark(item.remark) : undefined
  const baseRemark = publicView && !aiReview?.reviewRecord ? item.remark : remark?.baseRemark
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
          {note.reason && <p className="whitespace-pre-wrap break-words">{note.reason}</p>}
        </li>
      ))}
    </ol>
  )

  return (
    <>
      <div className="flex min-h-8 min-w-max items-center gap-2 whitespace-nowrap text-xs">
        <button type="button" aria-expanded={expanded} aria-controls={detailId} aria-label="词条详情"
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-default-500/20"
          onClick={() => setExpanded(value => !value)}>
          <ChevronRight className={`size-4 ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
        </button>
        <span className="tabular-nums">#{item.id}</span>
        <Chip size="sm" variant="flat" color={action.color}>{action.label}</Chip>
        {item.type && <Chip size="sm" variant="flat">{getPhraseTypeLabel(item.type)}</Chip>}
        {item.action === 'Change' && item.oldWord && (
          <>
            <del className="max-w-32 truncate opacity-75" title={item.oldWord}>{item.oldWord}</del>
            <span aria-hidden="true">→</span>
          </>
        )}
        <span className="max-w-40 truncate font-semibold" title={word}>{word}</span>
        {code && (
          <CodePhrasesPopover code={code}>
            <code className="cursor-pointer underline decoration-dotted underline-offset-2">{code}</code>
          </CodePhrasesPopover>
        )}
        <Link href={`/phrases/history?${new URLSearchParams({ word: item.oldWord || word, code })}`}
          aria-label="词条修改历史" title="词条修改历史" className="rounded-md p-1.5 hover:bg-default-500/20">
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
        {!publicView || aiReview?.reviewRecord ? (
          <Tooltip content={aiReview?.reviewRecord?.summary}>
            <Chip size="sm" variant="flat" color="primary" className={aiReview?.reviewRecord ? undefined : 'invisible'}
              startContent={<Bot className="size-3" aria-hidden="true" />}>喵审</Chip>
          </Tooltip>
        ) : <span className="w-14 shrink-0" aria-hidden="true" />}
        <Chip size="sm" variant="flat" color="warning" className={hasConflict ? undefined : 'invisible'}
          startContent={<AlertTriangle className="size-3" aria-hidden="true" />}>冲突</Chip>
        {reviewing && notes.length > 0 ? (
          <Popover placement="top">
            <PopoverTrigger className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-default-500/20"
              aria-label="词条审核记录" title="词条审核记录">
              <MessageSquareText className="size-4" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent aria-label="词条审核记录" className="max-h-72 max-w-xs overflow-auto p-3 text-small">
              {noteList}
            </PopoverContent>
          </Popover>
        ) : !publicView && <span className="size-7 shrink-0" aria-hidden="true" />}
        {!publicView && <span className="min-w-[4.5rem] shrink-0">
          {item._count && <BatchItemVoteCounts likes={item._count.likedBy} dislikes={item._count.dislikedBy} />}
        </span>}
        <div className="ml-auto">{actions}</div>
      </div>
      <div id={detailId} hidden={!expanded}
        className="mt-1 h-48 w-full max-w-xl space-y-2 overflow-auto break-words rounded-md bg-content1 px-3 py-2 text-small text-foreground">
        {expanded && (
          <>
            {item.weight != null && <p>权重：{item.weight}</p>}
            {baseRemark && <p className="whitespace-pre-wrap">备注：{baseRemark}</p>}
            {aiReview?.referenceEvidence && <p className="whitespace-pre-wrap text-default-600">{aiReview.referenceEvidence.line}</p>}
            {aiReview?.reviewRecord && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-primary">喵备注</span>
                {getMiaomiaoEvidenceHighlights(aiReview.reviewRecord).slice(0, 2).map(evidence => (
                  <span key={evidence} className="rounded-md bg-default-100 px-2 py-1">{evidence}</span>
                ))}
              </div>
            )}
            {aiNotice && (
              <div className="space-y-1">
                <p className="font-medium">{aiNotice.title}</p>
                {aiNotice.reasons.slice(0, 2).map((reason, index) => <p key={index}>{reason}</p>)}
                {aiNotice.suggestions[0] && <p>建议：{aiNotice.suggestions[0]}</p>}
              </div>
            )}
            {(conflictInfo?.impact || item.conflictReason) && <p className="text-warning">{conflictInfo?.impact || item.conflictReason}</p>}
            {rejectedReason && <p className="text-warning">拒绝原因：{rejectedReason}</p>}
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
            {remark?.review && <MiaomiaoDiffReview review={remark.review} />}
          </>
        )}
      </div>
    </>
  )
}
