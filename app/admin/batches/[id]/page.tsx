'use client'

import { type FormEvent, use, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tooltip,
} from '@/lib/heroui-compat'
import { AlertTriangle, ArrowDown, Check, ListOrdered, RefreshCw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { mutate as globalMutate } from 'swr'
import BatchPreview from '@/app/components/BatchPreview'
import ItemReviewDetail from '@/app/components/ItemReviewDetail'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { useUIStore } from '@/lib/store/ui'
import { useAuthStore } from '@/lib/store/auth'
import { usePageFilterStore } from '@/lib/store/pageFilter'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewItem } from '@/lib/types/batchAiReview'
import type { BatchReviewTier } from '@/lib/services/batchAiReviewService'

type ReviewDecision = 'Approved' | 'Rejected'

interface ItemReviewTarget {
  batchId: string
  itemId: number
  decision: ReviewDecision
  expectedContentVersion: number
}

interface PullRequest {
  id: number
  word: string | null
  oldWord?: string | null
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
  targetPhraseId?: number | null
  targetFingerprint?: string | null
  status: 'Pending' | ReviewDecision
  appliedAt?: string | null
  _count: { likedBy: number; dislikedBy: number }
  reviewNotes?: Array<{
    id: number
    decision: ReviewDecision
    reason: string
    createdAt: string
    reviewer?: { name: string; nickname?: string | null } | null
  }>
  type?: PhraseType | null
  weight: number | null
  remark: string | null
  readonly reviewFresh?: boolean
  suggestedOrderApplicable?: boolean
  hasConflict: boolean
  conflictReason: string | null
  conflictInfo?: {
    hasConflict: boolean
    impact?: string
  }
  phrase?: {
    id: number
    word: string
    code: string
  }
  aiReview?: BatchAiReviewItem & { tier?: BatchReviewTier; reviewDigestMatches?: boolean }
  dependencies: Array<{
    dependsOn: {
      id: number
      word: string | null
      code: string | null
    }
    reason: string
  }>
  dependedBy?: Array<{
    dependent: { id: number; word: string | null; code: string | null }
    reason: string
  }>
}

interface BatchDetail {
  id: string
  description: string
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected'
  createAt: string
  updateAt: string
  reviewNote: string | null
  contentVersion: number
  reviewProgress: {
    canFinalize: boolean
    pendingCount: number
    dependencyConflictCount: number
    dependencyPendingIds: number[]
    rejectedGroupIds: number[]
  }
  creator: {
    id: number
    name: string
    nickname: string | null
  }
  sourceIssue?: {
    id: number
    title: string
  }
  pullRequests: PullRequest[]
}

interface BatchReviewData {
  batch: BatchDetail
  // Confirmed local decisions advance the version without changing the displayed diff lines.
  reviewedFromContentVersion?: number
}

type ReviewBatchList = { batches: Array<Pick<BatchDetail, 'id' | 'createAt'>> }

interface BulkReviewTarget {
  itemIds: number[]
  expectedContentVersion: number
}

type PendingDecision = ReviewDecision | 'BulkApproved' | 'ApplyOrder'
type QueuedReview =
  | { itemIds: [number]; decision: ReviewDecision; word: string; reason?: string }
  | { itemIds: number[]; decision: 'Approved'; bulk: true }
  | { itemIds: [number]; order: NonNullable<BatchAiReviewItem['suggestedOrder']> }

type SavedItemReview = Pick<PullRequest, 'id' | 'status' | 'reviewNotes'> &
  Partial<Pick<PullRequest, 'weight' | 'remark' | 'reviewFresh' | '_count'>>

interface ItemReviewQueue {
  reviewerId: number
  batchId: string
  nextVersion: number
  entries: QueuedReview[]
  stopping?: boolean
}

const decisionLabels: Record<ReviewDecision, string> = {
  Approved: '同意',
  Rejected: '拒绝',
}

const reviewTierFilters = ['all', 'manual', 'look', 'safe'] as const
type ReviewTierFilter = typeof reviewTierFilters[number]

const reviewTierLabels: Record<ReviewTierFilter, string> = {
  all: '全部', manual: '需人工', look: '需查看', safe: '可放行',
}
const miaoReviewChunkSize = 12

function changedReviewContent(pr: PullRequest, latest: PullRequest) {
  return pr.action !== latest.action || pr.type !== latest.type || pr.weight !== latest.weight ||
    pr.oldWord !== latest.oldWord || (pr.word ?? pr.phrase?.word) !== (latest.word ?? latest.phrase?.word) ||
    (pr.code ?? pr.phrase?.code) !== (latest.code ?? latest.phrase?.code) || pr.phrase?.id !== latest.phrase?.id ||
    pr.targetPhraseId !== latest.targetPhraseId || pr.targetFingerprint !== latest.targetFingerprint
}

type ReviewSnapshot = ReadonlyMap<number, { item: PullRequest; orderedWeight?: number }>

function withReviewSnapshotItems(
  snapshot: ReviewSnapshot, batch: BatchDetail, ids: ReadonlySet<number>,
) {
  const next = new Map(snapshot)
  for (const item of batch.pullRequests) {
    if (ids.has(item.id)) next.set(item.id, { item, orderedWeight: item.weight ?? undefined })
  }
  return next
}

function getReviewErrorMessage(error: unknown, fallback: string) {
  const requestError = error as { info?: { details?: string }; message?: string } | null
  return requestError?.info?.details || requestError?.message || fallback
}

function ItemReviewDialog({
  target, word, initialReason, outdated, onSubmit, onClose,
}: {
  target: ItemReviewTarget
  word: string
  initialReason: string
  outdated: boolean
  onSubmit: (reason: string) => string | undefined
  onClose: () => void
}) {
  const [reason, setReason] = useState(initialReason)
  const [error, setError] = useState('')
  const reasonInputRef = useRef<HTMLTextAreaElement>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (outdated) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('请填写拒绝理由')
      reasonInputRef.current?.focus()
      return
    }
    setError('')
    const failure = onSubmit(trimmed)
    if (failure) setError(failure)
  }

  return (
    <Modal isOpen onClose={onClose} size="lg">
      <ModalContent aria-labelledby="item-review-dialog-title">
        <form
          method="post"
          action={`/api/admin/batches/${target.batchId}/items/${target.itemId}/review`}
          onSubmit={submit}
          aria-labelledby="item-review-dialog-title"
        >
          <ModalHeader id="item-review-dialog-title">拒绝「{word}」</ModalHeader>
          <ModalBody>
            <Textarea
              ref={reasonInputRef}
              label="拒绝理由"
              name="reason"
              value={reason}
              onValueChange={(value: string) => {
                setReason(value)
                setError('')
              }}
              isRequired
              required
              autoFocus
              maxLength={2000}
              minRows={3}
              aria-describedby={error ? 'item-review-error' : undefined}
            />
            {error && <p id="item-review-error" role="alert" className="text-small text-danger">{error}</p>}
            {outdated && (
              <p role="status" className="text-small text-warning">批次已更新，请关闭表单后重新核对这条词。</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="light" onPress={onClose}>取消</Button>
            <Button
              type="submit"
              color="danger"
              isDisabled={outdated}
            >
              确认拒绝
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}

export default function AdminBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const reviewerId = useAuthStore(state => state.user?.id)
  return <AdminBatchReview key={`${resolvedParams.id}:${reviewerId ?? ''}`} resolvedParams={resolvedParams} />
}

function AdminBatchReview({ resolvedParams }: { resolvedParams: { id: string } }) {
  const router = useRouter()
  const reviewPanel = useRef<HTMLDivElement>(null)
  const [tierFilter, setTierFilter] = useState<ReviewTierFilter>('all')
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [reviewTarget, setReviewTarget] = useState<ItemReviewTarget | null>(null)
  const [bulkReviewTarget, setBulkReviewTarget] = useState<BulkReviewTarget | null>(null)
  const reviewInFlight = useRef(false)
  const reviewQueue = useRef<ItemReviewQueue | null>(null)
  const orderItemsToSync = useRef(new Map<number, number>())
  const [pendingDecisions, setPendingDecisions] = useState<Record<number, PendingDecision>>({})
  const [rejectionDrafts, setRejectionDrafts] = useState<Record<number, string>>({})
  const [savingReviews, setSavingReviews] = useState(false)
  const [reviewSyncError, setReviewSyncError] = useState(false)
  const [unconfirmedReviews, setUnconfirmedReviews] = useState<{ batchId: string; itemIds: number[] } | null>(null)
  const attemptedFinalization = useRef<string | null>(null)
  const [finalizationError, setFinalizationError] = useState<{ key: string; message: string } | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [checkingTarget, setCheckingTarget] = useState<number | { current: number; total: number; stopping?: boolean } | null>(null)
  const stopMiaoReview = useRef(false)
  const { openAlert } = useUIStore()

  const detailUrl = `/api/admin/batches/${resolvedParams.id}`
  const { data: batch, error, isLoading, isValidating, mutate } = useAPI<BatchReviewData>(
    detailUrl,
    { withAuth: true, keepPreviousData: true, revalidateOnFocus: false, revalidateOnReconnect: false }
  )

  const batchDataForReview = batch?.batch
  if (batchDataForReview && !reviewSnapshot) {
    setReviewSnapshot(new Map(batchDataForReview.pullRequests.map(item => [item.id, { item }])))
  }
  const reviewBusy = savingReviews || finalizing || checkingTarget !== null
  const miaoProgress = typeof checkingTarget === 'object' ? checkingTarget : null
  const activeReview = reviewTarget && reviewTarget.batchId === resolvedParams.id ? reviewTarget : null
  const contentVersion = batchDataForReview?.contentVersion
  const batchCreatedAt = batchDataForReview?.createAt
  const canFinalize = !error && !reviewSyncError && batchDataForReview?.id === resolvedParams.id &&
    batchDataForReview.status === 'Submitted' && batchDataForReview.reviewProgress?.canFinalize
  const finalizationKey = `${resolvedParams.id}:${contentVersion}`
  const needsReviewConfirmation = unconfirmedReviews?.batchId === resolvedParams.id
  const displayedFinalizationError = finalizationError?.key === finalizationKey
    ? finalizationError.message
    : needsReviewConfirmation ? '有词条的审核决定未保存，请先核对现有结果。' : null
  const pullRequestById = useMemo(() => {
    return new Map((batchDataForReview?.pullRequests ?? []).map(pr => [pr.id, pr]))
  }, [batchDataForReview?.pullRequests])
  const reviewItems = useMemo(() => {
    const codeFor = (latest: PullRequest) => {
      const item = reviewSnapshot?.get(latest.id)?.item ?? latest
      return item.code ?? item.phrase?.code ?? ''
    }
    return [...(batchDataForReview?.pullRequests ?? [])]
      .sort((a, b) => codeFor(a).localeCompare(codeFor(b)) || a.id - b.id)
  }, [batchDataForReview?.pullRequests, reviewSnapshot])

  const batchStatus = batch?.batch.status
  const { data: batchList, mutate: mutateBatchList } = useAPI<ReviewBatchList>(
    batchStatus ? `/api/admin/batches?status=${batchStatus}` : null,
    { withAuth: true }
  )
  const navList = batchList?.batches ?? []
  const currentIndex = navList.findIndex(b => b.id === resolvedParams.id)
  const prevId = currentIndex > 0 ? navList[currentIndex - 1].id : null
  const nextId = currentIndex >= 0 && currentIndex < navList.length - 1 ? navList[currentIndex + 1].id : null

  const refreshPreview = useCallback(() => {
    const url = `/api/batches/${resolvedParams.id}/preview`
    return globalMutate((key: unknown) => Array.isArray(key) && (key[0] === url || key[0] === `${url}?review=1`))
      .catch(() => undefined)
  }, [resolvedParams.id])

  const syncReviewDetails = useCallback(async (reviewerId: number) => {
    if (useAuthStore.getState().user?.id !== reviewerId) return
    const latest = await apiRequest<BatchReviewData>(detailUrl)
    if (useAuthStore.getState().user?.id !== reviewerId) return
    let synced = false
    await mutate(current => {
      if (!current || current.batch.id !== latest.batch.id || current.batch.contentVersion > latest.batch.contentVersion) {
        return current
      }
      synced = true
      return {
        ...latest,
        reviewedFromContentVersion: current.batch.contentVersion === latest.batch.contentVersion
          ? current.reviewedFromContentVersion
          : undefined,
      }
    }, { revalidate: false })
    if (synced) {
      const ids = new Set<number>()
      for (const [id, version] of orderItemsToSync.current) {
        if (version > latest.batch.contentVersion) continue
        ids.add(id)
        orderItemsToSync.current.delete(id)
      }
      if (ids.size) setReviewSnapshot(snapshot => snapshot && withReviewSnapshotItems(snapshot, latest.batch, ids))
    }
    setReviewSyncError(false)
  }, [detailUrl, mutate])

  const refreshReviewDetails = useCallback(async () => {
    const reviewerId = useAuthStore.getState().user?.id
    if (reviewerId) await syncReviewDetails(reviewerId).catch(() => setReviewSyncError(true))
  }, [syncReviewDetails])

  const drainReviewQueue = async (queue: ItemReviewQueue) => {
    try {
      do {
        while (queue.entries.length) {
          const entry = queue.entries[0]
          const { itemIds } = entry
          if (useAuthStore.getState().user?.id !== queue.reviewerId) throw new Error('登录账号已变化')
          const expectedContentVersion = queue.nextVersion
          const endpoint = `/api/admin/batches/${queue.batchId}/items`
          let saved
          if ('order' in entry) {
            saved = await apiRequest<{ items: SavedItemReview[]; contentVersion: number }>(
              `${endpoint}/${itemIds[0]}/apply-order`,
              { method: 'POST', body: { chainDigest: entry.order.chainDigest, expectedContentVersion } },
            )
          } else if ('bulk' in entry) {
            saved = await apiRequest<{ items: SavedItemReview[]; contentVersion: number }>(
              `${endpoint}/review-bulk`, { method: 'POST', body: { itemIds, expectedContentVersion } },
            )
          } else {
            saved = await apiRequest<{ item: SavedItemReview; contentVersion: number }>(
              `${endpoint}/${itemIds[0]}/review`,
              { method: 'POST', body: { decision: entry.decision, reason: entry.reason, expectedContentVersion } },
            )
          }
          if (useAuthStore.getState().user?.id !== queue.reviewerId) throw new Error('登录账号已变化')
          queue.nextVersion = saved.contentVersion
          const savedItems = new Map(('items' in saved ? saved.items : [saved.item]).map(item => [item.id, item]))
          const orderIds = new Set('order' in entry ? savedItems.keys() : [])
          for (const id of orderIds) orderItemsToSync.current.set(id, saved.contentVersion)
          let orderBatch: BatchDetail | undefined
          await mutate(current => {
            if (!current || current.batch.id !== queue.batchId) return current
            if ('order' in entry && current.batch.contentVersion === saved.contentVersion) {
              // A preview refresh may have loaded the saved version before this response arrived.
              orderBatch = current.batch
              return current
            }
            if (current.batch.contentVersion !== expectedContentVersion) return current
            const pullRequests = current.batch.pullRequests.map(item => {
              const reviewed = savedItems.get(item.id)
              if (!reviewed) return item
              if (!('order' in entry)) return { ...item, status: reviewed.status, reviewNotes: reviewed.reviewNotes }
              const order = item.aiReview?.suggestedOrder
              const clearOrder = order?.code === entry.order.code && order.type === entry.order.type
              return {
                ...item, ...reviewed,
                ...(clearOrder ? {
                  suggestedOrderApplicable: false, aiReview: { ...item.aiReview!, suggestedOrder: undefined },
                } : {}),
              }
            })
            const batch = {
              ...current.batch,
              contentVersion: saved.contentVersion,
              pullRequests,
              reviewProgress: {
                ...current.batch.reviewProgress,
                canFinalize: false,
                pendingCount: pullRequests.filter(item => !item.appliedAt && item.status === 'Pending').length,
              },
            }
            if ('order' in entry) orderBatch = batch
            return {
              reviewedFromContentVersion: 'order' in entry
                ? saved.contentVersion : current.reviewedFromContentVersion ?? expectedContentVersion,
              batch,
            }
          }, { revalidate: false })
          if (orderBatch) {
            const updated = orderBatch
            setReviewSnapshot(snapshot => snapshot && withReviewSnapshotItems(snapshot, updated, orderIds))
          }
          queue.entries.shift()
          setUnconfirmedReviews(current => {
            if ('order' in entry || current?.batchId !== queue.batchId) return current
            const remaining = current.itemIds.filter(id => !savedItems.has(id))
            return remaining.length ? { batchId: current.batchId, itemIds: remaining } : null
          })
          setPendingDecisions(current => {
            const next = { ...current }
            for (const id of itemIds) delete next[id]
            return next
          })
          if ('reason' in entry && entry.reason !== undefined) setRejectionDrafts(current => {
            const next = { ...current }
            delete next[itemIds[0]]
            return next
          })
        }
        await syncReviewDetails(queue.reviewerId)
      } while (queue.entries.length)
    } catch (err) {
      queue.stopping = true
      const failed = queue.entries[0]
      if (failed) {
        const requestError = err as { status?: number; info?: { ineligibleIds?: number[] } } | null
        const ineligibleIds = 'bulk' in failed && requestError?.status === 409 &&
          Array.isArray(requestError.info?.ineligibleIds) ? requestError.info.ineligibleIds : null
        const remaining = queue.entries.slice(1).filter(entry => !('order' in entry)).flatMap(entry => entry.itemIds)
        const unsavedItemIds = ineligibleIds || 'order' in failed ? remaining : [...failed.itemIds, ...remaining]
        if (unsavedItemIds.length) setUnconfirmedReviews(current => ({
          batchId: queue.batchId,
          itemIds: current?.batchId === queue.batchId
            ? [...new Set([...current.itemIds, ...unsavedItemIds])]
            : unsavedItemIds,
        }))
        const message = getReviewErrorMessage(err, '审核结果保存失败')
        const label = 'order' in failed ? message : 'bulk' in failed
          ? ineligibleIds ? `${ineligibleIds.length} 条词条不满足批量放行条件` : message
          : `「${failed.word}」${message}`
        toast.error(`${label}${remaining.length ? `，另有 ${remaining.length} 条未保存` : ''}`)
        await syncReviewDetails(queue.reviewerId).catch(() => setReviewSyncError(true))
      } else {
        setReviewSyncError(true)
      }
    } finally {
      reviewQueue.current = null
      setPendingDecisions({})
      setSavingReviews(false)
    }
  }

  const enqueueReviews = (batchId: string, expectedContentVersion: number, entry: QueuedReview) => {
    const reviewerId = useAuthStore.getState().user?.id
    const currentQueue = reviewQueue.current
    if (!reviewerId || batchId !== batchDataForReview?.id ||
      batchDataForReview.status !== 'Submitted' || reviewInFlight.current || currentQueue?.stopping ||
      expectedContentVersion < (batch?.reviewedFromContentVersion ?? batchDataForReview.contentVersion) ||
      expectedContentVersion > batchDataForReview.contentVersion ||
      (currentQueue && (currentQueue.batchId !== batchId || currentQueue.reviewerId !== reviewerId))) {
      return '批次正在同步或状态已变化，请重试'
    }
    const queuedIds = new Set(currentQueue?.entries.flatMap(queued => queued.itemIds))
    if (entry.itemIds.some(id => queuedIds.has(id))) return '有词条的审核结果正在保存'
    if ('order' in entry && currentQueue?.entries.some(queued => 'order' in queued &&
      queued.order.code === entry.order.code && queued.order.type === entry.order.type)) {
      return '有词条的审核结果正在保存'
    }

    const queue: ItemReviewQueue = currentQueue ?? {
      reviewerId, batchId, nextVersion: batchDataForReview.contentVersion, entries: [],
    }
    queue.entries.push(entry)
    setPendingDecisions(current => {
      const next = { ...current }
      for (const id of entry.itemIds) {
        next[id] = 'order' in entry ? 'ApplyOrder' : 'bulk' in entry ? 'BulkApproved' : entry.decision
      }
      return next
    })
    if (!currentQueue) {
      reviewQueue.current = queue
      setSavingReviews(true)
      void drainReviewQueue(queue)
    }
  }

  const handleItemReview = (target: ItemReviewTarget, reason?: string) => {
    const item = pullRequestById.get(target.itemId)
    if (!item || item.appliedAt || item.status === target.decision) return '这条词的审核状态已变化'
    const failure = enqueueReviews(target.batchId, target.expectedContentVersion, {
      itemIds: [target.itemId], decision: target.decision, word: item.word ?? item.phrase?.word ?? '词条', reason,
    })
    if (!failure && reason !== undefined) {
      setRejectionDrafts(current => ({ ...current, [target.itemId]: reason }))
      setReviewTarget(null)
    }
    return failure
  }

  const selectReviewDecision = (itemId: number, decision: ReviewDecision) => {
    const item = pullRequestById.get(itemId)
    if (batchDataForReview?.status !== 'Submitted' || !item || item.status === decision || item.appliedAt ||
      error || reviewSyncError || activeReview || bulkReviewTarget || reviewInFlight.current || pendingDecisions[itemId]) return false
    setSelectedItemId(itemId)
    const target = {
      batchId: batchDataForReview.id, itemId, decision, expectedContentVersion: batchDataForReview.contentVersion,
    }
    if (decision === 'Rejected') {
      setReviewTarget(target)
      return true
    }
    const failure = handleItemReview(target)
    if (failure) toast.error(failure)
    return !failure
  }

  const reviewTierSelector = tierFilter === 'all' ? '' : `[data-review-tier="${tierFilter}"]`
  const jumpToReviewItem = (direction: 1 | -1) => {
    const rows = Array.from(reviewPanel.current?.querySelectorAll<HTMLElement>(`[data-review-item]${reviewTierSelector}`) ?? [])
    if (direction === -1) rows.reverse()
    const currentIndex = rows.findIndex(row => Number(row.dataset.reviewItem) === selectedItemId)
    const queuedItems = new Set(reviewQueue.current?.entries.flatMap(entry => entry.itemIds))
    const next = [...rows.slice(currentIndex + 1), ...rows.slice(0, currentIndex + 1)]
      .find(row => row.dataset.reviewPending === 'true' && !queuedItems.has(Number(row.dataset.reviewItem)))
    if (!next) return
    next.focus({ preventScroll: true })
    next.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  }

  const changeReviewTierFilter = (filter: ReviewTierFilter) => {
    if (tierFilter === filter) return
    setTierFilter(filter)
    setSelectedItemId(null)
  }

  const onReviewShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (batchDataForReview?.status !== 'Submitted' || activeReview || bulkReviewTarget || event.defaultPrevented ||
      event.isComposing || event.key === 'Process' || event.repeat || !event.altKey ||
      event.ctrlKey || event.metaKey || event.shiftKey ||
      (event.target instanceof HTMLElement && event.target.closest(
        'input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"], [role="alertdialog"]',
      ))) return

    if (event.code === 'KeyJ' || event.code === 'KeyK') {
      event.preventDefault()
      jumpToReviewItem(event.code === 'KeyJ' ? 1 : -1)
    } else if (event.code === 'KeyT') {
      event.preventDefault()
      const next = (reviewTierFilters.indexOf(tierFilter) + 1) % reviewTierFilters.length
      reviewPanel.current?.querySelector<HTMLElement>(`[data-tier-filter="${reviewTierFilters[next]}"]`)
        ?.focus({ preventScroll: true })
      changeReviewTierFilter(reviewTierFilters[next])
    } else if (selectedItemId !== null && (event.code === 'KeyA' || event.code === 'KeyR')) {
      if (event.target instanceof HTMLElement && event.target.closest('[data-review-stale]')) return
      const row = reviewPanel.current?.querySelector(`[data-review-item="${selectedItemId}"]${reviewTierSelector}:not([data-review-stale])`)
      if (!row) return
      event.preventDefault()
      const decision = event.code === 'KeyA' ? 'Approved' : 'Rejected'
      if (selectReviewDecision(selectedItemId, decision) && decision === 'Approved') jumpToReviewItem(1)
    }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => onReviewShortcut(event)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const finalizeReview = useCallback(async () => {
    const reviewerId = useAuthStore.getState().user?.id
    if (!canFinalize || !batchCreatedAt || contentVersion === undefined || !reviewerId ||
      isValidating || activeReview || reviewInFlight.current || reviewQueue.current) return

    attemptedFinalization.current = finalizationKey
    reviewInFlight.current = true
    setFinalizing(true)
    setFinalizationError(null)
    try {
      await apiRequest(`/api/admin/batches/${resolvedParams.id}/approve`, {
        method: 'POST',
        body: { expectedContentVersion: contentVersion },
        withAuth: true,
      })
      const pending = await apiRequest<ReviewBatchList>('/api/admin/batches?status=Submitted').catch(() => undefined)
      if (window.location.pathname !== `/admin/batches/${resolvedParams.id}` ||
        useAuthStore.getState().user?.id !== reviewerId) return

      if (pending) void mutateBatchList(pending, { revalidate: false }).catch(() => undefined)
      const nextBatch = pending?.batches.find(candidate => candidate.createAt > batchCreatedAt ||
        (candidate.createAt === batchCreatedAt && candidate.id > resolvedParams.id))
      setUnconfirmedReviews(current => current?.batchId === resolvedParams.id ? null : current)
      toast.success('逐条审核结果已提交')
      if (nextBatch) {
        router.replace(`/admin/batches/${nextBatch.id}`)
      } else {
        usePageFilterStore.getState().setFilter('/admin/batches', 'Submitted')
        router.replace('/admin/batches')
      }
    } catch (err) {
      const latest = await mutate().catch(() => undefined)
      if (!latest || latest.batch.status === 'Submitted') {
        const message = getReviewErrorMessage(err, '提交审核失败')
        setFinalizationError({ key: finalizationKey, message })
        toast.error(message)
      }
    } finally {
      reviewInFlight.current = false
      setFinalizing(false)
    }
  }, [activeReview, batchCreatedAt, canFinalize, contentVersion, finalizationKey, isValidating, mutate, mutateBatchList, resolvedParams.id, router])

  useEffect(() => {
    if (canFinalize && !needsReviewConfirmation && !isValidating && !reviewBusy && !activeReview && attemptedFinalization.current !== finalizationKey) {
      void finalizeReview()
    }
  }, [activeReview, canFinalize, finalizationKey, finalizeReview, isValidating, needsReviewConfirmation, reviewBusy])

  useEffect(() => () => {
    stopMiaoReview.current = true
  }, [])

  const handleAskMiaoAgain = async (prId?: number) => {
    if (
      !batchDataForReview || batchDataForReview.status === 'Approved' ||
      reviewInFlight.current || reviewQueue.current || reviewTarget?.batchId === batchDataForReview.id
    ) return

    let targetIds: number[]
    if (prId !== undefined) {
      const target = pullRequestById.get(prId)
      if (!target || target.appliedAt) return
      targetIds = [prId]
    } else {
      if (error || reviewSyncError) return
      const dependencyPendingIds = new Set(batchDataForReview.reviewProgress.dependencyPendingIds)
      const priority = (item: PullRequest) => item.status === 'Approved' && !dependencyPendingIds.has(item.id)
        ? reviewTierFilters.length : reviewTierFilters.indexOf(item.aiReview?.tier ?? 'look')
      targetIds = batchDataForReview.pullRequests
        .filter(item => !item.appliedAt && item.reviewFresh !== true)
        .sort((a, b) => priority(a) - priority(b))
        .map(item => item.id)
      if (!targetIds.length) {
        toast('没有需要复审的词条')
        return
      }
    }

    const reviewerId = useAuthStore.getState().user?.id
    const total = Math.ceil(targetIds.length / miaoReviewChunkSize)
    let completed = 0
    let warned = false
    let refresh: Promise<unknown> | undefined
    stopMiaoReview.current = false
    reviewInFlight.current = true
    try {
      for (let offset = 0; offset < targetIds.length; offset += miaoReviewChunkSize) {
        if (stopMiaoReview.current || useAuthStore.getState().user?.id !== reviewerId) break
        setCheckingTarget(prId ?? { current: completed + 1, total })
        const { warning } = await apiRequest<{ warning?: string }>(`/api/admin/batches/${batchDataForReview.id}/ai-review`, {
          method: 'POST',
          body: prId === undefined ? { prIds: targetIds.slice(offset, offset + miaoReviewChunkSize) } : { prId },
          withAuth: true,
        })
        completed++
        if (warning && !warned) {
          toast(warning)
          warned = true
        }
        refresh = prId === undefined
          ? mutate().catch(() => undefined)
          : Promise.allSettled([mutate(), refreshPreview()])
      }
    } catch (err) {
      const message = getReviewErrorMessage(err, '喵喵复查失败')
      if (prId === undefined) {
        toast.error(`${message}（已完成 ${completed}/${total} 组）`)
        refresh = mutate().catch(() => undefined)
      } else {
        if ((err as { status?: number }).status === 409) {
          await Promise.allSettled([mutate(), refreshPreview()])
        }
        openAlert(message, '操作失败')
      }
    } finally {
      await refresh
      reviewInFlight.current = false
      setCheckingTarget(null)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Submitted':
        return 'primary'
      case 'Approved':
        return 'success'
      case 'Rejected':
        return 'danger'
      default:
        return 'default'
    }
  }

  const getStatusText = (status: string) => {
    const map: Record<string, string> = {
      Submitted: '待审核',
      Approved: '已批准',
      Rejected: '已拒绝'
    }
    return map[status] || status
  }

  if (isLoading && !batch) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" label="加载中..." />
      </div>
    )
  }

  if (!batch || !reviewSnapshot) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="max-w-md">
          <CardBody className="text-center">
            <p className="text-danger mb-4">加载失败</p>
            <p className="text-default-500">{error?.message || '批次不存在'}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button isLoading={isValidating} onPress={() => void mutate().catch(() => undefined)}>
                重试加载
              </Button>
              <Button variant="light" onPress={() => router.push('/admin/batches')}>
                返回列表
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  const batchData = batch.batch
  const canReview = batchData.status === 'Submitted'
  const pendingReviewCount = batchData.reviewProgress.pendingCount
  const canAskMiao = batchData.status !== 'Approved' && batchData.pullRequests.some(item => !item.appliedAt)
  const hasConflicts = batchData.pullRequests.some(pr => pr.conflictInfo?.hasConflict ?? pr.hasConflict)
  const dependencyPendingIds = new Set(batchData.reviewProgress?.dependencyPendingIds)
  const showBulkReview = canReview && (tierFilter === 'all' || tierFilter === 'safe')
  const rejectedGroupIds = new Set(batchData.reviewProgress.rejectedGroupIds)
  const isStaleItem = (item: PullRequest) => {
    const snapshot = reviewSnapshot.get(item.id)?.item
    return !!snapshot && changedReviewContent(snapshot, item)
  }
  const bulkItemIds = showBulkReview ? batchData.pullRequests.filter(item => {
    return item.status === 'Pending' && !item.appliedAt && item.aiReview?.tier === 'safe' &&
      item.aiReview.reviewDigestMatches && !pendingDecisions[item.id] &&
      !item.reviewNotes?.some(note => note.decision === 'Rejected') &&
      !rejectedGroupIds.has(item.id) && !isStaleItem(item)
  }).slice(0, 500).map(pr => pr.id) : []
  const queuedBulkCount = Object.values(pendingDecisions).filter(decision => decision === 'BulkApproved').length
  const canQueueBulkReview = !error && !reviewSyncError && !finalizing && checkingTarget === null && !activeReview && !queuedBulkCount
  const bulkReviewOutdated = bulkReviewTarget && (
    !canQueueBulkReview ||
    bulkReviewTarget.expectedContentVersion < (batch.reviewedFromContentVersion ?? batchData.contentVersion) ||
    bulkReviewTarget.itemIds.some(id => !bulkItemIds.includes(id))
  )
  const confirmBulkReview = () => {
    if (!bulkReviewTarget || bulkReviewOutdated) return
    const failure = enqueueReviews(batchData.id, bulkReviewTarget.expectedContentVersion, {
      itemIds: bulkReviewTarget.itemIds, decision: 'Approved', bulk: true,
    })
    if (failure) toast.error(failure)
    else setBulkReviewTarget(null)
  }

  const awaitingReview = (item: PullRequest) => item.status === 'Pending' ||
    (!!batchData.reviewProgress.dependencyConflictCount && dependencyPendingIds.has(item.id))
  const tierCounts = { all: 0, manual: 0, look: 0, safe: 0 }
  let hasVisibleReviewItem = false
  for (const item of batchData.pullRequests) {
    if (item.appliedAt || !awaitingReview(item)) continue
    const tier = item.aiReview?.tier ?? 'look'
    tierCounts.all++
    tierCounts[tier]++
    if ((tierFilter === 'all' || tier === tierFilter) && !pendingDecisions[item.id] && !isStaleItem(item)) {
      hasVisibleReviewItem = true
    }
  }
  const activeItem = activeReview ? pullRequestById.get(activeReview.itemId) : undefined
  const reviewOutdated = !!activeReview && (
    activeReview.expectedContentVersion < (batch.reviewedFromContentVersion ?? batchData.contentVersion) ||
    activeReview.expectedContentVersion > batchData.contentVersion || !canReview || !!activeItem?.appliedAt
  )
  const renderReviewActions = (item: PullRequest, stale: boolean) => {
    if (item.appliedAt || !canAskMiao) return canReview ? <span className="block w-[8.5rem]" aria-hidden="true" /> : null
    const itemId = item.id
    const word = item.word ?? item.phrase?.word ?? '词条'
    const pendingDecision = pendingDecisions[itemId]
    const busy = stale || finalizing || checkingTarget !== null || !!activeReview || !!pendingDecision || !!error || reviewSyncError
    const selectedItem = selectedItemId === itemId && (tierFilter === 'all' || tierFilter === (item.aiReview?.tier ?? 'look'))
    const order = item.suggestedOrderApplicable ? item.aiReview?.suggestedOrder : undefined
    const savingOrder = pendingDecision === 'ApplyOrder'

    return (
      <div className="flex shrink-0 items-center gap-0.5">
        {canReview && (['Approved', 'Rejected'] as const).map(decision => {
          const selected = item.status === decision
          const saving = pendingDecision === decision
          const label = decisionLabels[decision]
          const Icon = decision === 'Approved' ? Check : X
          return (
            <Button
              key={decision}
              type="button"
              size="sm"
              isIconOnly
              className={`h-8 w-8 min-w-0 ${decision === 'Approved' ? 'text-success' : 'text-danger'}`}
              color={decision === 'Rejected' && selected ? 'danger' : undefined}
              variant={selected ? 'flat' : 'light'}
              aria-label={`${label}词条「${word}」${saving ? '（正在保存）' : ''}`}
              aria-keyshortcuts={selectedItem ? `Alt+${decision === 'Approved' ? 'A' : 'R'}` : undefined}
              aria-pressed={selected}
              aria-disabled={busy || selected || undefined}
              title={stale ? '差异已过期' : label}
              onPress={() => {
                if (!busy && !selected) selectReviewDecision(itemId, decision)
              }}
            >
              {saving
                ? <RefreshCw className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                : <Icon className="size-4" aria-hidden="true" />}
            </Button>
          )
        })}
        {canReview && (order ? (
          <Tooltip content={order.orderedWords.join(' › ')}>
            <Button
              type="button"
              size="sm"
              isIconOnly
              variant="light"
              className="h-8 w-8 min-w-0"
              aria-label="采纳喵喵排序"
              aria-busy={savingOrder || undefined}
              aria-disabled={busy || !!bulkReviewTarget || undefined}
              onPress={() => {
                if (busy || bulkReviewTarget) return
                const failure = enqueueReviews(batchData.id, batchData.contentVersion, { itemIds: [itemId], order })
                if (failure) toast.error(failure)
              }}
            >
              {savingOrder
                ? <RefreshCw className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                : <ListOrdered className="size-4" aria-hidden="true" />}
            </Button>
          </Tooltip>
        ) : <span className="size-8 shrink-0" aria-hidden="true" />)}
        <Button
          type="button"
          size="sm"
          isIconOnly
          variant="light"
          className="h-8 w-8 min-w-0 text-inherit"
          aria-label={`让喵再审词条「${word}」`}
          aria-disabled={stale || reviewBusy || !!activeReview || undefined}
          title="让喵再审"
          onPress={() => {
            if (!stale && !reviewBusy && !activeReview) void handleAskMiaoAgain(itemId)
          }}
        >
          <RefreshCw className={`size-4 ${checkingTarget === itemId ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
        </Button>
      </div>
    )
  }

  const renderReviewItem = (itemId: number, outdated: boolean, rejectedReason?: string) => {
    const latest = pullRequestById.get(itemId)
    const item = latest ?? reviewSnapshot.get(itemId)?.item
    if (!item) return null
    const tier = item.aiReview?.tier ?? 'look'
    const stale = outdated || !latest || isStaleItem(item)
    const actionable = canReview && !item.appliedAt
    const selected = actionable && selectedItemId === itemId && (tierFilter === 'all' || tierFilter === tier)
    return (
      <div role="group" aria-label={`审核词条「${item.word ?? item.phrase?.word ?? '词条'}」`}
        tabIndex={actionable ? -1 : undefined}
        data-review-item={itemId}
        data-review-pending={actionable && awaitingReview(item) && !pendingDecisions[itemId] && !stale}
        data-review-tier={tier}
        data-review-stale={stale || undefined}
        onFocusCapture={() => setSelectedItemId(actionable && !stale ? itemId : null)}
        className={`rounded-md ${selected ? 'ring-2 ring-inset ring-primary' : ''}`}>
        <ItemReviewDetail item={item} reviewing={canReview} rejectedReason={rejectedReason}
          waitingOnDependencies={item.status === 'Approved' && !item.appliedAt && dependencyPendingIds.has(itemId)}
          actions={renderReviewActions(item, stale)} />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="light"
              isDisabled={savingReviews || finalizing}
              onPress={() => router.push('/admin/batches')}
            >
              ← 返回列表
            </Button>
            <Button
              variant="flat"
              size="sm"
              isDisabled={!prevId || savingReviews || finalizing}
              onPress={() => prevId && router.push(`/admin/batches/${prevId}`)}
            >
              ← 上一个
            </Button>
            <Button
              variant="flat"
              size="sm"
              isDisabled={!nextId || savingReviews || finalizing}
              onPress={() => nextId && router.push(`/admin/batches/${nextId}`)}
            >
              下一个 →
            </Button>
            {navList.length > 0 && currentIndex >= 0 && (
              <span className="text-small text-default-400">
                {currentIndex + 1} / {navList.length}
              </span>
            )}
          </div>

          <Card>
            <CardHeader>
              <div className="flex w-full flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-2xl font-bold">
                      {batchData.description || '未命名批次'}
                    </h2>
                    <Chip
                      color={getStatusColor(batchData.status)}
                      variant="flat"
                    >
                      {getStatusText(batchData.status)}
                    </Chip>
                    {hasConflicts && (
                      <Chip color="warning" variant="flat" startContent={<AlertTriangle className="w-3 h-3" />}>
                        包含冲突
                      </Chip>
                    )}
                  </div>
                  <div className="space-y-1 text-small text-default-500">
                    <p>
                      创建者: {batchData.creator.nickname || batchData.creator.name}
                    </p>
                    <p>
                      创建时间: {new Date(batchData.createAt).toLocaleString('zh-CN')}
                    </p>
                    <p>
                      最后修改: {new Date(batchData.updateAt).toLocaleString('zh-CN')}
                    </p>
                    {batchData.sourceIssue && (
                      <p>
                        关联 Issue: #{batchData.sourceIssue.id} {batchData.sourceIssue.title}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(canAskMiao || miaoProgress) && (
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<RefreshCw className="size-4" aria-hidden="true" />}
                      isLoading={!!miaoProgress}
                      isDisabled={reviewBusy || !!activeReview || !!error || reviewSyncError}
                      onPress={() => void handleAskMiaoAgain()}
                    >
                      <span aria-live="polite" className="tabular-nums">
                        {miaoProgress ? `喵复审中 ${miaoProgress.current}/${miaoProgress.total}` : '请喵复审'}
                      </span>
                    </Button>
                  )}
                  {miaoProgress && (
                    <Button
                      size="sm"
                      variant="light"
                      isDisabled={miaoProgress.stopping || miaoProgress.current === miaoProgress.total}
                      onPress={() => {
                        stopMiaoReview.current = true
                        setCheckingTarget({ ...miaoProgress, stopping: true })
                      }}
                    >
                      停止复审
                    </Button>
                  )}
                  <Button
                    variant="flat"
                    size="sm"
                    isDisabled={savingReviews || finalizing}
                    onPress={() => router.push(`/batch/${resolvedParams.id}`)}
                  >
                    编辑批次
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        </div>

        {canReview && (
          <div className="sticky top-16 z-20 mb-4 rounded-lg border border-default-200 bg-background px-3 py-2">
            <Button size="sm" variant="flat" color="primary" aria-keyshortcuts="Alt+J"
              title="Alt+J / Alt+K" startContent={<ArrowDown className="size-4" aria-hidden="true" />}
              onPress={() => jumpToReviewItem(1)}
              isDisabled={!hasVisibleReviewItem}>
              下一个待审词条
            </Button>
          </div>
        )}
        <div ref={reviewPanel} className="space-y-6 mb-6">
          <BatchPreview batchId={resolvedParams.id}
            reviewing expectedContentVersion={batchData.contentVersion}
            reviewedFromContentVersion={canReview ? batch.reviewedFromContentVersion : undefined}
            reviewCounts={canReview ? {
              pending: pendingReviewCount,
              reviewed: batchData.pullRequests.length - pendingReviewCount,
            } : undefined}
            onNewerReviewPreview={refreshReviewDetails}
            reviewItems={reviewItems} renderReviewItem={renderReviewItem}
            getReviewWeight={id => reviewSnapshot.get(id)?.orderedWeight}
            renderReviewControls={outdated => canReview && (
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-2" role="group" aria-label="待审核筛选">
                  {reviewTierFilters.map(filter => (
                    <Button key={filter} type="button" size="sm" variant="flat" className="rounded-full tabular-nums"
                      color={tierFilter === filter ? 'primary' : undefined}
                      data-tier-filter={filter} aria-pressed={tierFilter === filter}
                      aria-keyshortcuts={tierFilter === filter ? 'Alt+T' : undefined}
                      title="Alt+T" onPress={() => changeReviewTierFilter(filter)}>
                      {reviewTierLabels[filter]} <span className="min-w-[3ch] text-end">{tierCounts[filter]}</span>
                    </Button>
                  ))}
                </div>
                <div className="h-8 w-36 shrink-0">
                  {showBulkReview && (queuedBulkCount > 0 || bulkItemIds.length > 0) && (
                    <Button type="button" size="sm" color="primary" className="h-full w-full tabular-nums"
                      isDisabled={outdated || !canQueueBulkReview} isLoading={queuedBulkCount > 0}
                      onPress={() => setBulkReviewTarget({ itemIds: bulkItemIds, expectedContentVersion: batchData.contentVersion })}>
                      全部通过（{queuedBulkCount || bulkItemIds.length}）
                    </Button>
                  )}
                </div>
              </div>
            )} />
          {(error || reviewSyncError) && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-danger" role="status">
              审核进度暂时无法同步。
              <Button
                size="sm"
                variant="light"
                isDisabled={reviewBusy || isValidating}
                onPress={() => void refreshReviewDetails()}
              >
                重试加载
              </Button>
            </div>
          )}
        </div>

        {canReview && (
          <Card>
            <CardBody className="gap-3">
              <div className="text-small text-default-600" aria-live="polite">
                {finalizing ? (
                  <p>正在提交审核结果…</p>
                ) : displayedFinalizationError ? (
                  <p className="text-danger">暂未提交。{displayedFinalizationError}</p>
                ) : canFinalize ? (
                  <p>词条审核已完成，即将自动提交。</p>
                ) : (
                  <p>全部词条都有审核结果，且相关依赖的决定一致后，系统会自动提交。</p>
                )}
                {!!batchData.reviewProgress?.pendingCount && (
                  <p>尚有 {batchData.reviewProgress.pendingCount} 条词条未审核，不能提交审核结果。</p>
                )}
                {!!batchData.reviewProgress?.dependencyConflictCount && (
                  <p className="text-warning">有 {batchData.reviewProgress.dependencyConflictCount} 组依赖的审核决定不一致。</p>
                )}
              </div>
              {displayedFinalizationError && canFinalize && (
                <Button
                  color="primary"
                  className="self-start"
                  onPress={() => void finalizeReview()}
                  isDisabled={reviewBusy || isValidating || !!activeReview}
                >
                  {needsReviewConfirmation ? '提交当前结果' : '重试提交'}
                </Button>
              )}
            </CardBody>
          </Card>
        )}

        {activeReview && activeItem && (
          <ItemReviewDialog
            key={`${activeReview.batchId}:${activeReview.itemId}:${activeReview.decision}`}
            target={activeReview}
            word={activeItem.word ?? activeItem.phrase?.word ?? '词条'}
            initialReason={rejectionDrafts[activeReview.itemId] ?? ''}
            outdated={reviewOutdated}
            onSubmit={reason => handleItemReview(activeReview, reason)}
            onClose={() => setReviewTarget(null)}
          />
        )}

        {bulkReviewTarget && (
          <Modal isOpen onClose={() => setBulkReviewTarget(null)}>
            <ModalContent aria-labelledby="bulk-review-dialog-title">
              <ModalHeader id="bulk-review-dialog-title">确认通过这 {bulkReviewTarget.itemIds.length} 条词条？</ModalHeader>
              {pendingReviewCount === bulkReviewTarget.itemIds.length +
                batchData.pullRequests.filter(pr => !pr.appliedAt && pr.status === 'Pending' &&
                  pendingDecisions[pr.id] && pendingDecisions[pr.id] !== 'ApplyOrder').length && (
                <ModalBody>将自动提交审核结果并进入下一批</ModalBody>
              )}
              <ModalFooter>
                <Button type="button" variant="light" onPress={() => setBulkReviewTarget(null)}>取消</Button>
                <Button type="button" color="primary" isDisabled={Boolean(bulkReviewOutdated)} onPress={confirmBulkReview}>
                  确认通过
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}

        {batchData.reviewNote && (
          <Card className="mt-4">
            <CardHeader>
              <h3 className="text-lg font-semibold">审核意见</h3>
            </CardHeader>
            <CardBody>
              <p className="text-default-600">{batchData.reviewNote}</p>
            </CardBody>
          </Card>
        )}
      </main>
    </div>
  )
}
