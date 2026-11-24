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
} from '@/lib/heroui-compat'
import { AlertTriangle, ArrowDown, Check, RefreshCw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { mutate as globalMutate } from 'swr'
import { BatchItemVoteCounts } from '@/app/components/BatchItemVote'
import BatchPreview from '@/app/components/BatchPreview'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import BatchPRList from '@/app/components/BatchPRList'
import { useUIStore } from '@/lib/store/ui'
import { useAuthStore } from '@/lib/store/auth'
import { usePageFilterStore } from '@/lib/store/pageFilter'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewItem } from '@/lib/types/batchAiReview'

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
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
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
  hasConflict: boolean
  conflictReason: string | null
  conflictInfo?: {
    hasConflict: boolean
    impact?: string
    suggestions?: Array<{
      action: string
      word?: string
      reason: string
    }>
  }
  phrase?: {
    id: number
    word: string
    code: string
  }
  aiReview?: BatchAiReviewItem
  conflicts: Array<{
    code: string
    currentWord: string | null
    proposedWord: string
  }>
  dependencies: Array<{
    dependsOn: {
      id: number
      word: string | null
      code: string | null
    }
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

interface QueuedItemReview extends ItemReviewTarget {
  word: string
  reason?: string
}

interface ItemReviewQueue {
  reviewerId: number
  batchId: string
  nextVersion: number
  entries: Map<number, QueuedItemReview>
  stopping?: boolean
}

const decisionLabels: Record<ReviewDecision, string> = {
  Approved: '同意',
  Rejected: '拒绝',
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
  const router = useRouter()
  const reviewPage = useRef<HTMLElement>(null)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [reviewTarget, setReviewTarget] = useState<ItemReviewTarget | null>(null)
  const reviewInFlight = useRef(false)
  const reviewQueue = useRef<ItemReviewQueue | null>(null)
  const [pendingDecisions, setPendingDecisions] = useState<Record<number, ReviewDecision>>({})
  const [rejectionDrafts, setRejectionDrafts] = useState<Record<number, string>>({})
  const [savingReviews, setSavingReviews] = useState(false)
  const [reviewSyncError, setReviewSyncError] = useState(false)
  const [unconfirmedReviews, setUnconfirmedReviews] = useState<{ batchId: string; itemIds: number[] } | null>(null)
  const attemptedFinalization = useRef<string | null>(null)
  const [finalizationError, setFinalizationError] = useState<{ key: string; message: string } | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [checkingTarget, setCheckingTarget] = useState<number | 'all' | null>(null)
  const { openAlert } = useUIStore()

  const detailUrl = `/api/admin/batches/${resolvedParams.id}`
  const { data: batch, error, isLoading, isValidating, mutate } = useAPI<BatchReviewData>(
    detailUrl,
    { withAuth: true, keepPreviousData: false, revalidateOnFocus: false, revalidateOnReconnect: false }
  )

  const batchDataForReview = batch?.batch
  const reviewBusy = savingReviews || finalizing || checkingTarget !== null
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
    await mutate(current => {
      if (!current || current.batch.id !== latest.batch.id || current.batch.contentVersion > latest.batch.contentVersion) {
        return current
      }
      return {
        ...latest,
        reviewedFromContentVersion: current.batch.contentVersion === latest.batch.contentVersion
          ? current.reviewedFromContentVersion
          : undefined,
      }
    }, { revalidate: false })
    setReviewSyncError(false)
  }, [detailUrl, mutate])

  const refreshReviewDetails = useCallback(async () => {
    const reviewerId = useAuthStore.getState().user?.id
    if (reviewerId) await syncReviewDetails(reviewerId).catch(() => setReviewSyncError(true))
  }, [syncReviewDetails])

  const drainReviewQueue = async (queue: ItemReviewQueue) => {
    try {
      do {
        for (const { itemId, decision, reason } of queue.entries.values()) {
          if (useAuthStore.getState().user?.id !== queue.reviewerId) throw new Error('登录账号已变化')
          const expectedContentVersion = queue.nextVersion
          const saved = await apiRequest<{ item: Pick<PullRequest, 'status' | 'reviewNotes'>; contentVersion: number }>(
            `/api/admin/batches/${queue.batchId}/items/${itemId}/review`,
            { method: 'POST', body: { decision, reason, expectedContentVersion } },
          )
          if (useAuthStore.getState().user?.id !== queue.reviewerId) throw new Error('登录账号已变化')
          queue.nextVersion = saved.contentVersion
          await mutate(current => {
            if (!current || current.batch.id !== queue.batchId || current.batch.contentVersion !== expectedContentVersion) return current
            const pullRequests = current.batch.pullRequests.map(item => item.id === itemId ? {
              ...item, status: saved.item.status, reviewNotes: saved.item.reviewNotes,
            } : item)
            return {
              reviewedFromContentVersion: current.reviewedFromContentVersion ?? expectedContentVersion,
              batch: {
                ...current.batch,
                contentVersion: saved.contentVersion,
                pullRequests,
                reviewProgress: {
                  ...current.batch.reviewProgress,
                  canFinalize: false,
                  pendingCount: pullRequests.filter(item => !item.appliedAt && item.status === 'Pending').length,
                },
              },
            }
          }, { revalidate: false })
          queue.entries.delete(itemId)
          setUnconfirmedReviews(current => {
            if (current?.batchId !== queue.batchId || !current.itemIds.includes(itemId)) return current
            const itemIds = current.itemIds.filter(id => id !== itemId)
            return itemIds.length ? { batchId: current.batchId, itemIds } : null
          })
          setPendingDecisions(current => {
            const next = { ...current }
            delete next[itemId]
            return next
          })
          if (reason !== undefined) setRejectionDrafts(current => {
            const next = { ...current }
            delete next[itemId]
            return next
          })
        }
        await syncReviewDetails(queue.reviewerId)
      } while (queue.entries.size)
    } catch (err) {
      queue.stopping = true
      const failed = queue.entries.values().next().value
      if (failed) {
        const remaining = queue.entries.size - 1
        const unsavedItemIds = [...queue.entries.keys()]
        setUnconfirmedReviews(current => ({
          batchId: queue.batchId,
          itemIds: current?.batchId === queue.batchId
            ? [...new Set([...current.itemIds, ...unsavedItemIds])]
            : unsavedItemIds,
        }))
        const message = getReviewErrorMessage(err, '审核结果保存失败')
        toast.error(`「${failed.word}」${message}${remaining ? `，另有 ${remaining} 条未保存` : ''}`)
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

  const handleItemReview = (target: ItemReviewTarget, reason?: string) => {
    const reviewerId = useAuthStore.getState().user?.id
    const item = pullRequestById.get(target.itemId)
    const currentQueue = reviewQueue.current
    if (!item || item.appliedAt || !reviewerId || target.batchId !== batchDataForReview?.id ||
      batchDataForReview.status !== 'Submitted' || reviewInFlight.current || currentQueue?.stopping ||
      target.expectedContentVersion < (batch?.reviewedFromContentVersion ?? batchDataForReview.contentVersion) ||
      target.expectedContentVersion > batchDataForReview.contentVersion ||
      (currentQueue && (currentQueue.batchId !== target.batchId || currentQueue.reviewerId !== reviewerId))) {
      return '批次正在同步或状态已变化，请重试'
    }
    if (item.status === target.decision || currentQueue?.entries.has(target.itemId)) return '这条词已有相同或待保存的结果'

    const queue = currentQueue ?? {
      reviewerId, batchId: target.batchId, nextVersion: batchDataForReview.contentVersion,
      entries: new Map<number, QueuedItemReview>(),
    }
    queue.entries.set(target.itemId, { ...target, word: item.word ?? item.phrase?.word ?? '词条', reason })
    setPendingDecisions(current => ({ ...current, [target.itemId]: target.decision }))
    if (reason !== undefined) {
      setRejectionDrafts(current => ({ ...current, [target.itemId]: reason }))
      setReviewTarget(null)
    }
    if (!currentQueue) {
      reviewQueue.current = queue
      setSavingReviews(true)
      void drainReviewQueue(queue)
    }
  }

  const selectReviewDecision = (itemId: number, decision: ReviewDecision) => {
    const item = pullRequestById.get(itemId)
    if (batchDataForReview?.status !== 'Submitted' || !item || item.status === decision || item.appliedAt ||
      error || reviewSyncError || activeReview || reviewInFlight.current || pendingDecisions[itemId]) return
    setSelectedItemId(itemId)
    const target = {
      batchId: batchDataForReview.id, itemId, decision, expectedContentVersion: batchDataForReview.contentVersion,
    }
    if (decision === 'Rejected') {
      setReviewTarget(target)
    } else {
      const failure = handleItemReview(target)
      if (failure) toast.error(failure)
    }
  }

  const jumpToReviewItem = (direction: 1 | -1) => {
    const rows = Array.from(reviewPage.current?.querySelectorAll<HTMLElement>('[data-review-item]') ?? [])
    if (direction === -1) rows.reverse()
    const currentIndex = rows.findIndex(row => Number(row.dataset.reviewItem) === selectedItemId)
    const next = [...rows.slice(currentIndex + 1), ...rows.slice(0, currentIndex + 1)]
      .find(row => row.dataset.reviewPending === 'true')
    if (!next) return
    next.focus({ preventScroll: true })
    next.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  }

  const onReviewShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (batchDataForReview?.status !== 'Submitted' || activeReview || event.defaultPrevented ||
      event.isComposing || event.key === 'Process' || event.repeat || !event.altKey ||
      event.ctrlKey || event.metaKey || event.shiftKey ||
      (event.target instanceof HTMLElement && event.target.closest(
        'input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"], [role="alertdialog"]',
      ))) return

    if (event.code === 'KeyJ' || event.code === 'KeyK') {
      event.preventDefault()
      jumpToReviewItem(event.code === 'KeyJ' ? 1 : -1)
    } else if (selectedItemId !== null && (event.code === 'KeyA' || event.code === 'KeyR')) {
      const row = reviewPage.current?.querySelector(`[data-review-item="${selectedItemId}"]:not([data-review-stale])`)
      if (!row) return
      event.preventDefault()
      selectReviewDecision(selectedItemId, event.code === 'KeyA' ? 'Approved' : 'Rejected')
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

  const handleAskMiaoAgain = async (prId?: number) => {
    if (
      !batchDataForReview || batchDataForReview.status === 'Approved' ||
      reviewInFlight.current || reviewQueue.current || reviewTarget?.batchId === batchDataForReview.id
    ) return
    if (prId !== undefined) {
      const target = pullRequestById.get(prId)
      if (!target || target.appliedAt) return
    } else if (!batchDataForReview.pullRequests.some(item => !item.appliedAt)) {
      return
    }
    reviewInFlight.current = true
    setCheckingTarget(prId ?? 'all')
    try {
      await apiRequest(`/api/admin/batches/${batchDataForReview.id}/ai-review`, {
        method: 'POST',
        body: prId === undefined ? {} : { prId },
        withAuth: true,
      })
      await Promise.allSettled([mutate(), refreshPreview()])
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        await Promise.allSettled([mutate(), refreshPreview()])
      }
      openAlert(getReviewErrorMessage(err, '喵喵复查失败'), '操作失败')
    } finally {
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

  if (!batch) {
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
  const canAskMiao = batchData.status !== 'Approved' && batchData.pullRequests.some(item => !item.appliedAt)
  const hasConflicts = batchData.pullRequests.some(pr => pr.conflictInfo?.hasConflict ?? pr.hasConflict)
  const dependencyPendingIds = new Set(batchData.reviewProgress?.dependencyPendingIds)
  const pendingPullRequests: PullRequest[] = []
  const approvedPullRequests: PullRequest[] = []
  for (const pr of batchData.pullRequests) {
    if (pr.status === 'Approved' && (pr.appliedAt || !dependencyPendingIds.has(pr.id))) {
      approvedPullRequests.push(pr)
    } else {
      pendingPullRequests.push(pr)
    }
  }
  const activeItem = activeReview ? pullRequestById.get(activeReview.itemId) : undefined
  const reviewOutdated = !!activeReview && (
    activeReview.expectedContentVersion < (batch.reviewedFromContentVersion ?? batchData.contentVersion) ||
    activeReview.expectedContentVersion > batchData.contentVersion || !canReview || !!activeItem?.appliedAt
  )
  const lineActionItems = canAskMiao ? batchData.pullRequests.filter(pr => !pr.appliedAt).map(pr => ({
    id: pr.id,
    label: pr.word ?? pr.phrase?.word ?? '词条',
    code: pr.code ?? pr.phrase?.code,
  })) : undefined

  const renderReviewActions = (itemId: number, stale = false) => {
    const item = pullRequestById.get(itemId)
    if (!item || item.appliedAt || !canAskMiao) return null
    const word = item.word ?? item.phrase?.word ?? '词条'
    const pendingDecision = pendingDecisions[itemId]
    const busy = stale || finalizing || checkingTarget !== null || !!activeReview || !!pendingDecision || !!error || reviewSyncError
    const selectedItem = selectedItemId === itemId && canReview
    const awaitingReview = item.status === 'Pending' ||
      (!!batchData.reviewProgress?.dependencyConflictCount && dependencyPendingIds.has(itemId))
    const tally = item._count

    return (
      <div role="group" aria-label={`审核词条「${word}」`}
        tabIndex={canReview ? -1 : undefined}
        data-review-item={canReview ? itemId : undefined}
        data-review-pending={canReview && awaitingReview && !pendingDecision && !stale}
        data-review-stale={stale || undefined}
        onFocusCapture={() => setSelectedItemId(itemId)}
        className={`flex shrink-0 items-center gap-0.5 rounded-lg ${selectedItem ? 'ring-2 ring-primary' : ''}`}>
        {tally && (
          <span className="me-2">
            <BatchItemVoteCounts likes={tally.likedBy} dislikes={tally.dislikedBy} />
          </span>
        )}
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
              title={label}
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

  const renderReviewFooter = (itemId: number) => {
    const item = pullRequestById.get(itemId)
    if (!item) return null
    const waitingOnDependencies = item.status === 'Approved' && !item.appliedAt && dependencyPendingIds.has(item.id)
    const notes = item.reviewNotes ?? []
    if (!waitingOnDependencies && !notes.length && item.status !== 'Rejected') return null

    return (
      <div className="mt-3 space-y-3 border-t border-default-200 pt-3">
        {item.status === 'Rejected' && <Chip size="sm" color="danger" variant="flat">已拒绝</Chip>}
        {waitingOnDependencies && (
          <Chip size="sm" color="warning" variant="flat">已同意，等待依赖处理</Chip>
        )}
        {notes.length > 0 && (
          <ol className="space-y-2" aria-label="词条审核记录">
            {notes.map(note => (
              <li key={note.id} className="text-small">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="font-medium">{decisionLabels[note.decision]} · {note.reviewer?.nickname || note.reviewer?.name || '审核员'}</p>
                  <time className="text-default-500" dateTime={note.createdAt}>
                    {new Date(note.createdAt).toLocaleString('zh-CN')}
                  </time>
                </div>
                {note.reason && <p className="whitespace-pre-wrap break-words text-default-600">{note.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <main ref={reviewPage} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                  {canAskMiao && (
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<RefreshCw className="size-4" aria-hidden="true" />}
                      isLoading={checkingTarget === 'all'}
                      isDisabled={reviewBusy || !!activeReview}
                      onPress={() => void handleAskMiaoAgain()}
                    >
                      请喵复审
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
          <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-default-200 bg-background px-3 py-2">
            <Button size="sm" variant="flat" color="primary" aria-keyshortcuts="Alt+J"
              startContent={<ArrowDown className="size-4" aria-hidden="true" />}
              onPress={() => jumpToReviewItem(1)}
              isDisabled={!batchData.reviewProgress?.pendingCount && !batchData.reviewProgress?.dependencyConflictCount}>
              下一个待审词条
            </Button>
            <p className="text-small text-default-600">
              <kbd>Alt+J</kbd> 下一个 <span aria-hidden="true">·</span> <kbd>Alt+K</kbd> 上一个
              {' '}<span aria-hidden="true">·</span> <kbd>Alt+A</kbd> 同意当前词条
              {' '}<span aria-hidden="true">·</span> <kbd>Alt+R</kbd> 拒绝当前词条
              {' '}<span>（Mac 用 Option ⌥）</span>
            </p>
          </div>
        )}
        <div className="space-y-6 mb-6">
          <BatchPreview batchId={resolvedParams.id} reviewing expectedContentVersion={batchData.contentVersion}
            reviewedFromContentVersion={canReview ? batch.reviewedFromContentVersion : undefined}
            onNewerReviewPreview={refreshReviewDetails}
            lineActionItems={lineActionItems} renderLineActions={renderReviewActions} />
          <section aria-labelledby="pending-item-reviews">
            <h3 id="pending-item-reviews" className="text-xl font-semibold">
              待审核 <span className="text-default-500">{pendingPullRequests.length}</span>
            </h3>
            {pendingPullRequests.length > 0 ? (
              <BatchPRList pullRequests={pendingPullRequests} renderItemFooter={renderReviewFooter} />
            ) : <p className="mt-2 text-small text-default-500">暂无待审核词条。</p>}
          </section>
          <section aria-labelledby="approved-item-reviews">
            <h3 id="approved-item-reviews" className="text-xl font-semibold">
              已通过 <span className="text-default-500">{approvedPullRequests.length}</span>
            </h3>
            {approvedPullRequests.length > 0 ? (
              <BatchPRList pullRequests={approvedPullRequests} renderItemFooter={renderReviewFooter} />
            ) : <p className="mt-2 text-small text-default-500">暂无已通过词条。</p>}
          </section>
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
