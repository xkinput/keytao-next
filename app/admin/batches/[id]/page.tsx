'use client'

import { use, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip,
  Textarea
} from '@heroui/react'
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

interface PullRequest {
  id: number
  word: string | null
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
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
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Published'
  createAt: string
  updateAt: string
  reviewNote: string | null
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

export default function AdminBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [reviewNote, setReviewNote] = useState('')
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
    { withAuth: true }
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

  const afterReview = () => {
    if (nextId) {
      router.push(`/admin/batches/${nextId}`)
    } else {
      openAlert('所有待审批次已处理完毕，即将返回列表', '审核完成')
      setTimeout(() => router.push('/admin/batches'), 1500)
    }
  }

  const handleApprove = async () => {
    openConfirm('确定要批准这个批次吗？', async () => {
      setProcessing(true)
      try {
        await apiRequest(`/api/admin/batches/${resolvedParams.id}/approve`, {
          method: 'POST',
          body: { reviewNote: reviewNote || undefined },
          withAuth: true
        })
        afterReview()
      } catch (err) {
        const error = err as Error
        openAlert(error.message || '批准失败', '操作失败')
      } finally {
        setProcessing(false)
      }
    }, '确认批准', '批准')
  }

  const handleReject = async () => {
    if (!reviewNote.trim()) {
      openAlert('拒绝时必须填写审核意见', '验证错误')
      return
    }

    openConfirm('确定要拒绝这个批次吗？', async () => {
      setProcessing(true)
      try {
        await apiRequest(`/api/admin/batches/${resolvedParams.id}/reject`, {
          method: 'POST',
          body: { reviewNote },
          withAuth: true
        })
        afterReview()
      } catch (err) {
        const error = err as Error
        openAlert(error.message || '拒绝失败', '操作失败')
      } finally {
        setProcessing(false)
      }
    }, '确认拒绝', '拒绝', '取消')
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
      setReviewNote(result.aiReview.suggestedReviewNote)
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
      Rejected: '已拒绝',
      Published: '已发布'
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
  const hasConflicts = batchData.pullRequests.some(pr => pr.conflictInfo?.hasConflict ?? pr.hasConflict)
  const aiItemsByPrId = new Map((aiReview?.items ?? []).map(item => [item.prId, item]))
  const displayedPullRequests = aiReview
    ? batchData.pullRequests.map(pr => ({
      ...pr,
      aiReview: aiItemsByPrId.get(pr.id) ?? pr.aiReview,
    }))
    : batchData.pullRequests

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
          <BatchPRList pullRequests={displayedPullRequests} />
        </div>

        {canReview && (
          <Card>
            <CardHeader>
              <h3 className="text-xl font-bold">审核操作</h3>
            </CardHeader>
            <CardBody>
              <Textarea
                label="审核意见"
                placeholder={hasConflicts ? "批次包含冲突；拒绝时写明原因" : "拒绝时填写原因；批准可留空"}
                value={reviewNote}
                onValueChange={setReviewNote}
                minRows={2}
                className="mb-4"
              />

              {hasConflicts && (
                <div className="mb-4 p-3 bg-warning-50 dark:bg-warning-100/10 rounded-lg">
                  <p className="text-small text-warning flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> 警告: 该批次包含冲突的修改，建议仔细审核或拒绝
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  color="success"
                  onPress={handleApprove}
                  isLoading={processing}
                  isDisabled={processing}
                >
                  批准
                </Button>
                <Button
                  color="danger"
                  variant="flat"
                  onPress={handleReject}
                  isLoading={processing}
                  isDisabled={processing}
                >
                  拒绝
                </Button>
              </div>
            </CardBody>
          </Card>
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
