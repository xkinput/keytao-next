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
import { AlertTriangle, Bot, CheckCircle2, RefreshCw, Search } from 'lucide-react'
import BatchPreview from '@/app/components/BatchPreview'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import BatchPRList from '@/app/components/BatchPRList'
import { useUIStore } from '@/lib/store/ui'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import type {
  BatchAiReviewItem,
  BatchAiReviewResult,
  BatchAiReviewVerdict,
} from '@/lib/types/batchAiReview'

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
  aiReview?: BatchAiReviewResult
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
  const label = decisionLabels[target.decision]

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (processing || outdated) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('请填写审核原因')
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
          <ModalHeader id="item-review-dialog-title">{label}「{word}」</ModalHeader>
          <ModalBody>
            <Textarea
              ref={reasonInputRef}
              label="审核原因"
              name="reason"
              value={reason}
              onValueChange={(value: string) => {
                setReason(value)
                setError('')
              }}
              isRequired
              required
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
              color={target.decision === 'Approved' ? 'success' : 'danger'}
              isLoading={processing}
              isDisabled={processing || outdated}
            >
              确认{label}
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
  const [processing, setProcessing] = useState(false)
  const [checkingTarget, setCheckingTarget] = useState<number | 'all' | null>(null)
  const [expandedReviewIds, setExpandedReviewIds] = useState<number[]>([])
  const [manualReviewResult, setManualReviewResult] = useState<{
    batchId: string
    aiReview: BatchAiReviewResult
  } | null>(null)
  const { openAlert, openConfirm } = useUIStore()

  const { data: batch, error, isLoading, mutate } = useAPI<{ batch: BatchDetail }>(
    `/api/admin/batches/${resolvedParams.id}`,
    { withAuth: true, keepPreviousData: false }
  )

  const batchDataForReview = batch?.batch
  const serverAiReview = batchDataForReview?.aiReview
  const manualAiReview = manualReviewResult && manualReviewResult.batchId === batchDataForReview?.id
    ? manualReviewResult.aiReview
    : undefined
  const aiReview = manualAiReview ?? serverAiReview
  const pullRequestById = useMemo(() => {
    return new Map((batchDataForReview?.pullRequests ?? []).map(pr => [pr.id, pr]))
  }, [batchDataForReview?.pullRequests])
  const humanReviewItems = useMemo(() => {
    return (aiReview?.items ?? []).filter(item => item.status !== 'pass')
  }, [aiReview?.items])
  const missingMiaoItems = useMemo(() => {
    return humanReviewItems.filter(item => {
      const pr = pullRequestById.get(item.prId)
      return !item.reviewRecord && pr?.action !== 'Delete'
    })
  }, [humanReviewItems, pullRequestById])
  const compactChainNotes = useMemo(() => {
    return (aiReview?.codeChains ?? [])
      .flatMap(chain => chain.recommendations.map(recommendation => ({
        key: `${chain.type}:${chain.code}:${recommendation}`,
        code: chain.code,
        type: chain.type,
        recommendation,
      })))
      .filter(note =>
        note.recommendation.includes('首位')
        || note.recommendation.includes('提频')
        || note.recommendation.includes('语料频次')
        || note.recommendation.includes('词典收录')
        || note.recommendation.includes('语料参考')
        || note.recommendation.includes('移除')
        || note.recommendation.includes('移入')
        || note.recommendation.includes('移出')
      )
      .slice(0, 4)
  }, [aiReview?.codeChains])

  const batchStatus = batch?.batch.status
  const { data: batchList } = useAPI<{ batches: Array<{ id: string }> }>(
    batchStatus ? `/api/admin/batches?status=${batchStatus}` : null,
    { withAuth: true }
  )
  const navList = batchList?.batches ?? []
  const currentIndex = navList.findIndex(b => b.id === resolvedParams.id)
  const prevId = currentIndex > 0 ? navList[currentIndex - 1].id : null
  const nextId = currentIndex >= 0 && currentIndex < navList.length - 1 ? navList[currentIndex + 1].id : null

  const openItemReview = (itemId: number, decision: ReviewDecision) => {
    if (reviewInFlight.current || batchDataForReview?.status !== 'Submitted') return
    setReviewTarget({
      batchId: batchDataForReview.id,
      itemId,
      decision,
      expectedContentVersion: batchDataForReview.contentVersion,
    })
  }

  const handleItemReview = async (reason: string) => {
    if (
      !reviewTarget || reviewInFlight.current ||
      reviewTarget.batchId !== resolvedParams.id ||
      batchDataForReview?.status !== 'Submitted' ||
      reviewTarget.expectedContentVersion !== batchDataForReview?.contentVersion
    ) return
    reviewInFlight.current = true
    setProcessing(true)
    try {
      const { batchId, itemId, decision, expectedContentVersion } = reviewTarget
      await apiRequest(`/api/admin/batches/${batchId}/items/${itemId}/review`, {
        method: 'POST',
        body: { decision, reason, expectedContentVersion },
        withAuth: true,
      })
      setReviewTarget(null)
      await mutate().catch(() => undefined)
    } catch (err) {
      if ((err as { status?: number }).status === 409) await mutate().catch(() => undefined)
      return getReviewErrorMessage(err, '词条审核失败')
    } finally {
      reviewInFlight.current = false
      setProcessing(false)
    }
  }

  const handleFinalize = () => {
    if (!batchDataForReview?.reviewProgress?.canFinalize || reviewInFlight.current) return
    const { id, contentVersion } = batchDataForReview
    openConfirm('确定提交逐条审核结果吗？已通过的词条将应用到词库。', async () => {
      if (reviewInFlight.current) return
      reviewInFlight.current = true
      setProcessing(true)
      try {
        await apiRequest(`/api/admin/batches/${id}/approve`, {
          method: 'POST',
          body: { expectedContentVersion: contentVersion },
          withAuth: true,
        })
        await mutate().catch(() => undefined)
        openAlert('逐条审核结果已提交', '审核完成')
      } catch (err) {
        if ((err as { status?: number }).status === 409) await mutate().catch(() => undefined)
        openAlert(getReviewErrorMessage(err, '提交审核失败'), '操作失败')
      } finally {
        reviewInFlight.current = false
        setProcessing(false)
      }
    }, '提交审核', '提交')
  }

  const handleAskMiaoAgain = async (prId?: number) => {
    setCheckingTarget(prId ?? 'all')
    try {
      const result = await apiRequest<{
        aiReview: BatchAiReviewResult
        focusItem?: BatchAiReviewItem
      }>(`/api/admin/batches/${resolvedParams.id}/ai-review`, {
        method: 'POST',
        body: prId ? { prId } : {},
        withAuth: true,
      })
      setManualReviewResult({
        batchId: resolvedParams.id,
        aiReview: result.aiReview,
      })
      await mutate()
      if (prId) {
        setExpandedReviewIds(current => current.includes(prId) ? current : [...current, prId])
      }
    } catch (err) {
      const error = err as Error
      openAlert(error.message || '喵喵复查失败', '操作失败')
    } finally {
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

  const getAiVerdictColor = (verdict: BatchAiReviewVerdict): 'success' | 'warning' | 'danger' => {
    const map: Record<BatchAiReviewVerdict, 'success' | 'warning' | 'danger'> = {
      pass: 'success',
      needs_attention: 'warning',
      manual_review: 'danger'
    }
    return map[verdict]
  }

  const getAiVerdictText = (verdict: BatchAiReviewVerdict) => {
    const map: Record<BatchAiReviewVerdict, string> = {
      pass: '建议可通过',
      needs_attention: '建议复核',
      manual_review: '需人工确认'
    }
    return map[verdict]
  }

  const getAiAlertClass = (item: BatchAiReviewItem) => {
    if (item.status === 'manual_review') {
      return 'border-danger-200 bg-danger-50/70 dark:bg-danger-100/10'
    }
    return 'border-warning-200 bg-warning-50/70 dark:bg-warning-100/10'
  }

  const getReviewTargetLabel = (item: BatchAiReviewItem) => {
    const pr = pullRequestById.get(item.prId)
    const word = pr?.word || pr?.phrase?.word || '未命名词条'
    const code = pr?.code || pr?.phrase?.code || '无编码'
    return `「${word}」@${code}`
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
  const reviewBusy = processing || checkingTarget !== null
  const hasConflicts = batchData.pullRequests.some(pr => pr.conflictInfo?.hasConflict ?? pr.hasConflict)
  const aiItemsByPrId = new Map((aiReview?.items ?? []).map(item => [item.prId, item]))
  const displayedPullRequests = aiReview
    ? batchData.pullRequests.map(pr => ({
      ...pr,
      aiReview: aiItemsByPrId.get(pr.id) ?? pr.aiReview,
    }))
    : batchData.pullRequests
  const dependencyPendingIds = new Set(batchData.reviewProgress?.dependencyPendingIds)
  const pendingPullRequests: PullRequest[] = []
  const approvedPullRequests: PullRequest[] = []
  for (const pr of displayedPullRequests) {
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

  const renderReviewFooter = (itemId: number) => {
    const item = pullRequestById.get(itemId)
    if (!item) return null
    const canDecide = canReview && !item.appliedAt
    const notes = item.reviewNotes ?? []
    if (!canDecide && !notes.length && item.status !== 'Rejected') return null
    const word = item.word ?? item.phrase?.word ?? '词条'

    return (
      <div className="mt-3 space-y-3 border-t border-default-200 pt-3">
        {item.status === 'Rejected' && <Chip size="sm" color="danger" variant="flat">已拒绝</Chip>}
        {item.status === 'Approved' && !item.appliedAt && dependencyPendingIds.has(item.id) && (
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
                <p className="whitespace-pre-wrap break-words text-default-600">{note.reason}</p>
              </li>
            ))}
          </ol>
        )}
        {canDecide && (
          <div className="flex flex-wrap gap-2">
            {item.status !== 'Approved' && (
              <Button
                size="sm"
                color="success"
                variant="flat"
                aria-label={`同意词条「${word}」`}
                isDisabled={reviewBusy}
                onPress={() => openItemReview(itemId, 'Approved')}
              >
                同意
              </Button>
            )}
            {item.status !== 'Rejected' && (
              <Button
                size="sm"
                color="danger"
                variant="flat"
                aria-label={`拒绝词条「${word}」`}
                isDisabled={reviewBusy}
                onPress={() => openItemReview(itemId, 'Rejected')}
              >
                拒绝
              </Button>
            )}
          </div>
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
              <div className="flex justify-between items-start w-full">
                <div className="flex-1">
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
                <Button
                  variant="flat"
                  size="sm"
                  onPress={() => router.push(`/batch/${resolvedParams.id}`)}
                >
                  编辑批次
                </Button>
              </div>
            </CardHeader>
          </Card>
        </div>

        <div className="space-y-6 mb-6">
          {aiReview && (
            <Card>
              <CardBody className="space-y-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary dark:bg-primary-100/10">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">喵喵审核</h3>
                        <Chip color={getAiVerdictColor(aiReview.verdict)} variant="flat" size="sm">
                          {getAiVerdictText(aiReview.verdict)}
                        </Chip>
                      </div>
                      <p className="max-w-3xl text-small text-default-600">{aiReview.headline}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Chip size="sm" color="danger" variant="flat">
                      人看 {humanReviewItems.length}
                    </Chip>
                    <Chip size="sm" color="primary" variant="flat">
                      喵审 {aiReview.riskCounts.botReviewed}/{aiReview.items.length}
                    </Chip>
                    {missingMiaoItems.length > 0 && (
                      <Chip size="sm" color="warning" variant="flat">
                        无备注 {missingMiaoItems.length}
                      </Chip>
                    )}
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<RefreshCw className="h-4 w-4" />}
                      isLoading={checkingTarget === 'all'}
                      isDisabled={reviewBusy}
                      onPress={() => handleAskMiaoAgain()}
                    >
                      请喵复审
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
                  <section className="rounded-lg border border-default-200 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        <p className="font-medium">需要人再看</p>
                      </div>
                      <span className="text-tiny text-default-400">只列风险项和无喵备注项</span>
                    </div>

                    {humanReviewItems.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-md bg-success-50 px-3 py-2 text-small text-success-700 dark:bg-success-100/10">
                        <CheckCircle2 className="h-4 w-4" />
                        没有需要单独复核的条目。
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {humanReviewItems.map(item => {
                          const expanded = expandedReviewIds.includes(item.prId)
                          return (
                            <article key={item.prId} className={`rounded-md border px-3 py-2 ${getAiAlertClass(item)}`}>
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <Chip size="sm" color={item.severity} variant="flat">
                                  PR#{item.prId}
                                </Chip>
                                <span className="text-small font-medium">{getReviewTargetLabel(item)}</span>
                                {!item.reviewRecord && pullRequestById.get(item.prId)?.action !== 'Delete' && (
                                  <Chip size="sm" color="warning" variant="flat">
                                    无喵备注
                                  </Chip>
                                )}
                              </div>
                              <p className="text-small text-default-700">{item.reasons[0]}</p>
                              {expanded && (
                                <div className="mt-2 space-y-1 border-t border-default-200 pt-2">
                                  {item.reasons.slice(1, 3).map((reason, index) => (
                                    <p key={`reason-${item.prId}-${index}`} className="text-small text-default-600">
                                      {reason}
                                    </p>
                                  ))}
                                  {item.suggestions.slice(0, 2).map((suggestion, index) => (
                                    <p key={`suggestion-${item.prId}-${index}`} className="text-small text-default-500">
                                      建议：{suggestion}
                                    </p>
                                  ))}
                                </div>
                              )}
                              <div className="mt-2 flex justify-end">
                                <Button
                                  size="sm"
                                  variant="light"
                                  startContent={<Search className="h-3.5 w-3.5" />}
                                  isLoading={checkingTarget === item.prId}
                                  isDisabled={reviewBusy}
                                  onPress={() => handleAskMiaoAgain(item.prId)}
                                >
                                  让喵再审
                                </Button>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  <aside className="rounded-lg border border-default-200 bg-default-50/60 p-4 dark:bg-default-100/5">
                    <p className="mb-3 font-medium">快速判断</p>
                    <div className="space-y-2 text-small text-default-600">
                      <p>通过：{aiReview.riskCounts.pass}</p>
                      <p>需复核：{aiReview.riskCounts.attention}</p>
                      <p>人工确认：{aiReview.riskCounts.manualReview}</p>
                      <p>缺喵备注：{missingMiaoItems.length}</p>
                    </div>

                    {compactChainNotes.length > 0 && (
                      <div className="mt-4 border-t border-default-200 pt-3">
                        <p className="mb-2 text-small font-medium">编码链提示</p>
                        <div className="space-y-2">
                          {compactChainNotes.map(note => (
                            <p key={note.key} className="text-small text-default-500">
                              <code className="text-primary">{note.code}</code>：{note.recommendation}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </aside>
                </div>
              </CardBody>
            </Card>
          )}
          <BatchPreview batchId={resolvedParams.id} />
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
                isLoading={processing && !activeReview}
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
            processing={processing}
            outdated={reviewOutdated}
            onSubmit={handleItemReview}
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
