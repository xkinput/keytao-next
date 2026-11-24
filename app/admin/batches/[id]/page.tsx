'use client'

import { type FormEvent, use, useMemo, useRef, useState } from 'react'
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
import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react'
import { mutate as globalMutate } from 'swr'
import BatchPreview from '@/app/components/BatchPreview'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import BatchPRList from '@/app/components/BatchPRList'
import { useUIStore } from '@/lib/store/ui'
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

const decisionLabels: Record<ReviewDecision, string> = {
  Approved: '同意',
  Rejected: '拒绝',
}

function getReviewErrorMessage(error: unknown, fallback: string) {
  const requestError = error as { info?: { details?: string }; message?: string } | null
  return requestError?.info?.details || requestError?.message || fallback
}

function ItemReviewDialog({
  target, word, processing, outdated, onSubmit, onClose,
}: {
  target: ItemReviewTarget
  word: string
  processing: boolean
  outdated: boolean
  onSubmit: (reason: string) => Promise<string | undefined>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const reasonInputRef = useRef<HTMLTextAreaElement>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (processing || outdated) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('请填写拒绝理由')
      reasonInputRef.current?.focus()
      return
    }
    setError('')
    const failure = await onSubmit(trimmed)
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
              isDisabled={processing}
              aria-describedby={error ? 'item-review-error' : undefined}
            />
            {error && <p id="item-review-error" role="alert" className="text-small text-danger">{error}</p>}
            {outdated && (
              <p role="status" className="text-small text-warning">批次已更新，请关闭表单后重新核对这条词。</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="light" isDisabled={processing} onPress={onClose}>取消</Button>
            <Button
              type="submit"
              color="danger"
              isLoading={processing}
              isDisabled={processing || outdated}
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
  const [reviewTarget, setReviewTarget] = useState<ItemReviewTarget | null>(null)
  const reviewInFlight = useRef(false)
  const [processingTarget, setProcessingTarget] = useState<number | 'batch' | null>(null)
  const [checkingTarget, setCheckingTarget] = useState<number | 'all' | null>(null)
  const { openAlert, openConfirm } = useUIStore()

  const { data: batch, error, isLoading, mutate } = useAPI<{ batch: BatchDetail }>(
    `/api/admin/batches/${resolvedParams.id}`,
    { withAuth: true, keepPreviousData: false }
  )

  const batchDataForReview = batch?.batch
  const pullRequestById = useMemo(() => {
    return new Map((batchDataForReview?.pullRequests ?? []).map(pr => [pr.id, pr]))
  }, [batchDataForReview?.pullRequests])

  const batchStatus = batch?.batch.status
  const { data: batchList } = useAPI<{ batches: Array<{ id: string }> }>(
    batchStatus ? `/api/admin/batches?status=${batchStatus}` : null,
    { withAuth: true }
  )
  const navList = batchList?.batches ?? []
  const currentIndex = navList.findIndex(b => b.id === resolvedParams.id)
  const prevId = currentIndex > 0 ? navList[currentIndex - 1].id : null
  const nextId = currentIndex >= 0 && currentIndex < navList.length - 1 ? navList[currentIndex + 1].id : null

  const refreshPreview = () =>
    globalMutate((key: unknown) => Array.isArray(key) && key[0] === `/api/batches/${resolvedParams.id}/preview`)
      .catch(() => undefined)

  const handleItemReview = async (target: ItemReviewTarget, reason?: string) => {
    const item = pullRequestById.get(target.itemId)
    if (
      !item || item.appliedAt || item.status === target.decision || reviewInFlight.current ||
      target.batchId !== resolvedParams.id ||
      batchDataForReview?.status !== 'Submitted' ||
      target.expectedContentVersion !== batchDataForReview.contentVersion
    ) return
    reviewInFlight.current = true
    setProcessingTarget(target.itemId)
    try {
      const { batchId, itemId, decision, expectedContentVersion } = target
      await apiRequest(`/api/admin/batches/${batchId}/items/${itemId}/review`, {
        method: 'POST',
        body: { decision, reason, expectedContentVersion },
        withAuth: true,
      })
      setReviewTarget(null)
      if (decision === 'Rejected' || item.status === 'Rejected') refreshPreview()
      await mutate().catch(() => undefined)
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        refreshPreview()
        await mutate().catch(() => undefined)
      }
      return getReviewErrorMessage(err, '词条审核失败')
    } finally {
      reviewInFlight.current = false
      setProcessingTarget(null)
    }
  }

  const handleFinalize = () => {
    if (!batchDataForReview?.reviewProgress?.canFinalize || reviewInFlight.current) return
    const { id, contentVersion } = batchDataForReview
    openConfirm('确定提交逐条审核结果吗？已通过的词条将应用到词库。', async () => {
      if (reviewInFlight.current) return
      reviewInFlight.current = true
      setProcessingTarget('batch')
      try {
        await apiRequest(`/api/admin/batches/${id}/approve`, {
          method: 'POST',
          body: { expectedContentVersion: contentVersion },
          withAuth: true,
        })
        refreshPreview()
        await mutate().catch(() => undefined)
        openAlert('逐条审核结果已提交', '审核完成')
      } catch (err) {
        if ((err as { status?: number }).status === 409) await mutate().catch(() => undefined)
        openAlert(getReviewErrorMessage(err, '提交审核失败'), '操作失败')
      } finally {
        reviewInFlight.current = false
        setProcessingTarget(null)
      }
    }, '提交审核', '提交')
  }

  const handleAskMiaoAgain = async (prId?: number) => {
    if (
      !batchDataForReview || batchDataForReview.status === 'Approved' ||
      reviewInFlight.current || reviewTarget?.batchId === batchDataForReview.id
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" label="加载中..." />
      </div>
    )
  }

  if (error || !batch) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="max-w-md">
          <CardBody className="text-center">
            <p className="text-danger mb-4">加载失败</p>
            <p className="text-default-500">{error?.message || '批次不存在'}</p>
            <Button
              className="mt-4"
              onPress={() => router.push('/admin/batches')}
            >
              返回列表
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const batchData = batch.batch
  const canReview = batchData.status === 'Submitted'
  const canAskMiao = batchData.status !== 'Approved' && batchData.pullRequests.some(item => !item.appliedAt)
  const reviewBusy = processingTarget !== null || checkingTarget !== null
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
  const activeReview = reviewTarget?.batchId === batchData.id ? reviewTarget : null
  const activeItem = activeReview ? pullRequestById.get(activeReview.itemId) : undefined
  const reviewOutdated = !!activeReview && (
    activeReview.expectedContentVersion !== batchData.contentVersion || !canReview || !!activeItem?.appliedAt
  )
  const lineActionItems = canAskMiao ? batchData.pullRequests.filter(pr => !pr.appliedAt).map(pr => ({
    id: pr.id,
    label: pr.word ?? pr.phrase?.word ?? '词条',
    code: pr.code ?? pr.phrase?.code,
  })) : undefined

  const renderReviewActions = (itemId: number) => {
    const item = pullRequestById.get(itemId)
    if (!item || item.appliedAt || !canAskMiao) return null
    const word = item.word ?? item.phrase?.word ?? '词条'
    const busy = reviewBusy || !!activeReview

    return (
      <div role="group" aria-label={`审核词条「${word}」`}
        aria-busy={processingTarget === itemId || checkingTarget === itemId}
        className="flex shrink-0 items-center gap-0.5">
        {canReview && (['Approved', 'Rejected'] as const).map(decision => {
          const selected = item.status === decision
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
              aria-label={`${label}词条「${word}」`}
              aria-pressed={selected}
              aria-disabled={busy || selected || undefined}
              title={label}
              onPress={() => {
                if (busy || selected || reviewInFlight.current) return
                const target = {
                  batchId: batchData.id, itemId, decision, expectedContentVersion: batchData.contentVersion,
                }
                if (decision === 'Rejected') {
                  setReviewTarget(target)
                } else {
                  void handleItemReview(target).then(failure => {
                    if (failure) openAlert(failure, '操作失败')
                  })
                }
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
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
          aria-disabled={busy || undefined}
          title="让喵再审"
          onPress={() => {
            if (!busy) void handleAskMiaoAgain(itemId)
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="light"
              onPress={() => router.push('/admin/batches')}
            >
              ← 返回列表
            </Button>
            <Button
              variant="flat"
              size="sm"
              isDisabled={!prevId}
              onPress={() => prevId && router.push(`/admin/batches/${prevId}`)}
            >
              ← 上一个
            </Button>
            <Button
              variant="flat"
              size="sm"
              isDisabled={!nextId}
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
                    onPress={() => router.push(`/batch/${resolvedParams.id}`)}
                  >
                    编辑批次
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        </div>

        <div className="space-y-6 mb-6">
          <BatchPreview batchId={resolvedParams.id} expectedContentVersion={batchData.contentVersion}
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
        </div>

        {canReview && (
          <Card>
            <CardBody className="gap-3">
              <div className="text-small text-default-600" aria-live="polite">
                {batchData.reviewProgress?.canFinalize ? (
                  <p>本批次的词条审核已完成。</p>
                ) : (
                  <p>全部词条都有审核结果，且相关依赖的决定一致后，即可提交。</p>
                )}
                {!!batchData.reviewProgress?.pendingCount && (
                  <p>待决定 {batchData.reviewProgress.pendingCount} 条。</p>
                )}
                {!!batchData.reviewProgress?.dependencyConflictCount && (
                  <p className="text-warning">有 {batchData.reviewProgress.dependencyConflictCount} 组依赖的审核决定不一致。</p>
                )}
              </div>
              <Button
                color="primary"
                className="self-start"
                onPress={handleFinalize}
                isLoading={processingTarget === 'batch'}
                isDisabled={reviewBusy || !batchData.reviewProgress?.canFinalize}
              >
                提交审核
              </Button>
            </CardBody>
          </Card>
        )}

        {activeReview && activeItem && (
          <ItemReviewDialog
            key={`${activeReview.batchId}:${activeReview.itemId}:${activeReview.decision}`}
            target={activeReview}
            word={activeItem.word ?? activeItem.phrase?.word ?? '词条'}
            processing={processingTarget === activeReview.itemId}
            outdated={reviewOutdated}
            onSubmit={reason => handleItemReview(activeReview, reason)}
            onClose={() => {
              if (!reviewInFlight.current) setReviewTarget(null)
            }}
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
