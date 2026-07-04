'use client'

import { use, useState } from 'react'
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
import { AlertTriangle, Bot, CheckCircle2, FilePenLine, ListChecks } from 'lucide-react'
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
  const { openAlert, openConfirm } = useUIStore()

  const { data: batch, error, isLoading } = useAPI<{ batch: BatchDetail }>(
    `/api/admin/batches/${resolvedParams.id}`,
    { withAuth: true }
  )

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

  const formatChain = (entries: BatchAiReviewResult['codeChains'][number]['before']) => {
    if (entries.length === 0) return '空'
    return entries
      .slice(0, 6)
      .map(entry => `「${entry.word}」(${entry.weight ?? '?'})`)
      .join(' > ')
      + (entries.length > 6 ? ' > ...' : '')
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
  const aiReview = batchData.aiReview
  const aiAttentionItems = aiReview?.items.filter(item => item.status !== 'pass') ?? []

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
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between w-full">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="w-5 h-5 text-primary" />
                      <h3 className="text-xl font-bold">喵喵审核建议</h3>
                      <Chip color={getAiVerdictColor(aiReview.verdict)} variant="flat">
                        {getAiVerdictText(aiReview.verdict)}
                      </Chip>
                    </div>
                    <p className="text-default-600">{aiReview.headline}</p>
                  </div>
                  {canReview && (
                    <Button
                      color="primary"
                      variant="flat"
                      startContent={<FilePenLine className="w-4 h-4" />}
                      onPress={() => setReviewNote(aiReview.suggestedReviewNote)}
                    >
                      填入审核意见
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardBody className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <Chip size="sm" color="success" variant="flat">
                    建议通过 {aiReview.riskCounts.pass}
                  </Chip>
                  <Chip size="sm" color="warning" variant="flat">
                    需复核 {aiReview.riskCounts.attention}
                  </Chip>
                  <Chip size="sm" color="danger" variant="flat">
                    人工确认 {aiReview.riskCounts.manualReview}
                  </Chip>
                  <Chip size="sm" color="primary" variant="flat">
                    喵喵已审 {aiReview.riskCounts.botReviewed}
                  </Chip>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-default-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <ListChecks className="w-4 h-4 text-default-500" />
                      <p className="font-medium">审核检查</p>
                    </div>
                    <div className="space-y-2">
                      {aiReview.checklist.map((item, index) => (
                        <div key={index} className="flex gap-2 text-small text-default-600">
                          <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-default-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-warning" />
                      <p className="font-medium">需关注条目</p>
                    </div>
                    {aiAttentionItems.length === 0 ? (
                      <p className="text-small text-default-500">没有发现需要特别拎出的条目。</p>
                    ) : (
                      <div className="space-y-3">
                        {aiAttentionItems.map(item => (
                          <div key={item.prId} className="rounded-md bg-default-50 dark:bg-default-100/10 p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Chip size="sm" color={item.severity} variant="flat">
                                PR#{item.prId}
                              </Chip>
                              <span className="text-small font-medium">{item.title}</span>
                            </div>
                            <div className="space-y-1">
                              {item.reasons.slice(0, 2).map((reason, index) => (
                                <p key={index} className="text-small text-default-500">{reason}</p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-default-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FilePenLine className="w-4 h-4 text-default-500" />
                    <p className="font-medium">建议审核记录</p>
                  </div>
                  <pre className="whitespace-pre-wrap text-small text-default-600 font-sans leading-6">
                    {aiReview.suggestedReviewNote}
                  </pre>
                </div>

                {aiReview.codeChains.length > 0 && (
                  <div className="rounded-lg border border-default-200 p-4">
                    <p className="font-medium mb-3">编码链优先级建议</p>
                    <div className="space-y-4">
                      {aiReview.codeChains.map(chain => (
                        <div key={`${chain.type}:${chain.code}`} className="border-b border-default-100 last:border-b-0 pb-4 last:pb-0">
                          <div className="flex items-center gap-2 mb-2">
                            <code className="text-primary">{chain.code}</code>
                            <Chip size="sm" variant="flat">{chain.type}</Chip>
                          </div>
                          <div className="space-y-1 text-small text-default-500 mb-2">
                            <p>调整前：{formatChain(chain.before)}</p>
                            <p>调整后：{formatChain(chain.after)}</p>
                          </div>
                          <div className="space-y-1">
                            {chain.recommendations.map((recommendation, index) => (
                              <p key={index} className="text-small text-default-600">
                                {recommendation}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
          <BatchPreview batchId={resolvedParams.id} />
          <BatchPRList pullRequests={batchData.pullRequests} />
        </div>

        {canReview && (
          <Card>
            <CardHeader>
              <h3 className="text-xl font-bold">审核操作</h3>
            </CardHeader>
            <CardBody>
              <Textarea
                label="审核意见"
                placeholder={hasConflicts ? "批次包含冲突，拒绝时必须填写原因" : "可填入喵喵建议，或手写审核决定"}
                value={reviewNote}
                onValueChange={setReviewNote}
                minRows={3}
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
