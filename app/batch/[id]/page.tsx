'use client'

import { use, useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip,
  useDisclosure,
  Input
} from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { mutate as globalMutate } from 'swr'
import CreatePRModal from '@/app/components/CreatePRModal'
import BatchPreview from '@/app/components/BatchPreview'
import BatchPRList from '@/app/components/BatchPRList'
import BatchActionsDropdown from '@/app/components/BatchActionsDropdown'
import { useUIStore } from '@/lib/store/ui'
import { BATCH_STATUS_MAP, STATUS_COLOR_MAP } from '@/lib/constants/status'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import { formatBatchSubmitWarnings, type BatchSubmitWarning } from '@/lib/services/batchSubmitWarnings'
import { Edit, AlertTriangle, Lightbulb, Bot, CheckCircle2 } from 'lucide-react'
import type {
  BatchAiReviewItem,
  BatchAiReviewResult,
  BatchAiReviewVerdict,
} from '@/lib/types/batchAiReview'

interface PullRequest {
  id: number
  word: string | null
  oldWord?: string | null
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
  type?: PhraseType | null
  status: string
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
  dependencies: Array<{
    dependsOn: {
      id: number
      word: string | null
      code: string | null
      action: string
    }
    reason: string
  }>
  dependedBy: Array<{
    dependent: {
      id: number
      word: string | null
      code: string | null
      action: string
    }
    reason: string
  }>
  conflicts: Array<{
    code: string
    currentWord: string | null
    proposedWord: string
  }>
}

interface BatchDetail {
  id: string
  description: string
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Published'
  createAt: string
  updateAt: string
  creator: {
    id: number
    name: string
    nickname: string | null
  }
  reviewNote?: string | null
  sourceIssue?: {
    id: number
    title: string
    content: string
  }
  pullRequests: PullRequest[]
  aiReview?: BatchAiReviewResult
}

function getAiVerdictColor(verdict: BatchAiReviewVerdict): 'success' | 'warning' | 'danger' {
  const map: Record<BatchAiReviewVerdict, 'success' | 'warning' | 'danger'> = {
    pass: 'success',
    needs_attention: 'warning',
    manual_review: 'danger'
  }
  return map[verdict]
}

function getAiVerdictText(verdict: BatchAiReviewVerdict) {
  const map: Record<BatchAiReviewVerdict, string> = {
    pass: '本喵建议可通过',
    needs_attention: '本喵建议复核',
    manual_review: '需要人工确认'
  }
  return map[verdict]
}

function getAiAlertClass(item: BatchAiReviewItem) {
  if (item.status === 'manual_review') {
    return 'border-danger-200 bg-danger-50/70 dark:bg-danger-100/10'
  }
  return 'border-warning-200 bg-warning-50/70 dark:bg-warning-100/10'
}

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const { user, isAdmin } = useAuthStore()
  const [submitting, setSubmitting] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [batchName, setBatchName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { openAlert, openConfirm } = useUIStore()

  const { data: batch, error, isLoading, mutate } = useAPI<{ batch: BatchDetail }>(
    `/api/batches/${resolvedParams.id}`
  )

  const batchStatus = batch?.batch.status
  const aiReview = batch?.batch.aiReview
  const pullRequestById = useMemo(() => {
    return new Map((batch?.batch.pullRequests ?? []).map(pr => [pr.id, pr]))
  }, [batch?.batch.pullRequests])
  const humanReviewItems = useMemo(() => {
    return (aiReview?.items ?? []).filter(item => item.status !== 'pass')
  }, [aiReview?.items])
  const compactChainNotes = useMemo(() => {
    return (aiReview?.codeChains ?? [])
      .flatMap(chain => chain.recommendations.map(recommendation => ({
        key: `${chain.type}:${chain.code}:${recommendation}`,
        code: chain.code,
        recommendation,
      })))
      .filter(note =>
        note.recommendation.includes('首位')
        || note.recommendation.includes('提频')
        || note.recommendation.includes('移除')
        || note.recommendation.includes('移入')
        || note.recommendation.includes('移出')
      )
      .slice(0, 3)
  }, [aiReview?.codeChains])

  const isPrivateStatus = batchStatus === 'Draft' || batchStatus === 'Rejected'
  const { data: batchList } = useAPI<{ batches: Array<{ id: string }> }>(
    batchStatus ? `/api/batches?status=${batchStatus}&pageSize=500${isPrivateStatus ? '&onlyMine=true' : ''}` : null,
    isPrivateStatus ? { withAuth: true } : undefined
  )
  const navList = batchList?.batches ?? []
  const currentIndex = navList.findIndex(b => b.id === resolvedParams.id)
  const prevId = currentIndex > 0 ? navList[currentIndex - 1].id : null
  const nextId = currentIndex >= 0 && currentIndex < navList.length - 1 ? navList[currentIndex + 1].id : null

  // Initialize batch name when data loads
  useEffect(() => {
    if (batch?.batch.description) {
      setBatchName(batch.batch.description)
    }
  }, [batch?.batch.description])

  const handleSaveName = async () => {
    if (!batchName.trim()) {
      openAlert('批次名称不能为空', '验证错误')
      return
    }

    setSavingName(true)
    try {
      await apiRequest(`/api/batches/${resolvedParams.id}`, {
        method: 'PATCH',
        body: { description: batchName },
        withAuth: true
      })
      await mutate()
      setEditingName(false)
    } catch (err) {
      const error = err as Error
      openAlert(error.message || '保存失败', '出错了')
    } finally {
      setSavingName(false)
    }
  }

  const handleCancelEditName = () => {
    setBatchName(batch?.batch.description || '')
    setEditingName(false)
  }

  const handleCloseModal = () => {
    onClose()
  }

  const handleSubmit = async () => {
    if (!batch) return

    const items = batch.batch.pullRequests.map((pr) => ({
      id: pr.id.toString(),
      action: pr.action,
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: (pr.type || 'Phrase') as PhraseType,
      weight: pr.weight || undefined
    }))

    const submitBatch = async (confirmed = false) => {
      setSubmitting(true)
      try {
        await apiRequest(`/api/batches/${resolvedParams.id}/submit`, {
          method: 'POST',
          body: confirmed ? { confirmed: true } : undefined,
          withAuth: true
        })
        openAlert('批次已提交审核', '提交成功')
        await mutate()
      } catch (err) {
        console.error('Submit batch error:', err)
        const error = err as Error & {
          info?: {
            error?: string
            requiresConfirmation?: boolean
            warnings?: BatchSubmitWarning[]
            conflicts?: Array<{
              hasConflict: boolean
              code: string
              impact?: string
              currentPhrase?: { word: string }
            }>
          }
          status?: number
        }

        if (error.info?.requiresConfirmation && error.info.warnings?.length) {
          const message =
            '! 重要提示 - 请仔细阅读以下警告\n\n' +
            formatBatchSubmitWarnings(error.info.warnings, items).join('\n\n' + '─'.repeat(50) + '\n\n') +
            '\n\n确认要继续提交吗？'

          openConfirm(message, async () => {
            await submitBatch(true)
          }, '提交审核', '确认提交', '取消')
          return
        }

        // Construct detailed error message with conflicts
        throw new Error(
          error.info?.conflicts && error.info.conflicts.length > 0
            ? `${error.message}\n\n冲突详情：\n${error.info.conflicts
              .map((c, i) => `${i + 1}. ${c.impact || '未知冲突'}`)
              .join('\n')}`
            : error.message
        )
      } finally {
        setSubmitting(false)
      }
    }

    openConfirm('确定要提交审核吗？', async () => {
      await submitBatch()
    }, '提交审核', '提交')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size="lg" label="加载中..." />
      </div>
    )
  }

  if (error || !batch) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <Card className="max-w-md">
          <CardBody className="text-center">
            <p className="text-danger mb-4">加载失败</p>
            <p className="text-default-500">{error?.message || '批次不存在'}</p>
            <Button
              className="mt-4"
              onPress={() => router.push('/')}
            >
              返回列表
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const batchData = batch.batch
  const isOwner = user?.id === batchData.creator.id
  const isDraftOwnedByViewer = batchData.status === 'Draft' && isOwner
  const editableStatuses = isAdmin
    ? ['Draft', 'Rejected', 'Submitted']
    : ['Draft', 'Rejected']
  const canEdit = (isOwner || isAdmin) && editableStatuses.includes(batchData.status)
  const getReviewTargetLabel = (item: BatchAiReviewItem) => {
    const pr = pullRequestById.get(item.prId)
    const word = pr?.word || pr?.phrase?.word || '未命名词条'
    const code = pr?.code || pr?.phrase?.code || '无编码'
    return `「${word}」@${code}`
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="light"
              onPress={() => router.push('/')}
            >
              ← 返回列表
            </Button>
            <Button
              variant="flat"
              size="sm"
              isDisabled={!prevId}
              onPress={() => prevId && router.push(`/batch/${prevId}`)}
            >
              ← 上一个
            </Button>
            <Button
              variant="flat"
              size="sm"
              isDisabled={!nextId}
              onPress={() => nextId && router.push(`/batch/${nextId}`)}
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
                    {editingName ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={batchName}
                          onChange={(e) => setBatchName(e.target.value)}
                          placeholder="输入批次名称"
                          className="flex-1"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          color="primary"
                          onPress={handleSaveName}
                          isLoading={savingName}
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="light"
                          onPress={handleCancelEditName}
                          isDisabled={savingName}
                        >
                          取消
                        </Button>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-2xl font-bold">
                          {batchData.description || '未命名批次'}
                        </h2>
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="light"
                            isIconOnly
                            onPress={() => setEditingName(true)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        )}
                      </>
                    )}
                    <Chip
                      color={STATUS_COLOR_MAP[batchData.status] || 'default'}
                      variant="flat"
                      size="lg"
                      className={batchData.status === 'Draft' ? 'font-semibold bg-warning-100 text-warning-700 border border-warning-300 shadow-sm' : undefined}
                    >
                      {BATCH_STATUS_MAP[batchData.status] || batchData.status}
                    </Chip>
                  </div>
                  <div className="text-small text-default-500 space-y-0.5">
                    <p>由 {batchData.creator.nickname || batchData.creator.name} 创建于{' '}
                      {new Date(batchData.createAt).toLocaleString('zh-CN')}
                    </p>
                    <p>最后修改：{new Date(batchData.updateAt).toLocaleString('zh-CN')}</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {canEdit && (
                    <>
                      <Button color="primary" onPress={onOpen}>
                        {batchData.pullRequests.length > 0 ? '编辑修改' : '添加修改'}
                      </Button>
                      {batchData.pullRequests.length > 0 && (
                        <Button
                          color="success"
                          onPress={handleSubmit}
                          isLoading={submitting}
                        >
                          提交审核
                        </Button>
                      )}
                    </>
                  )}
                  {batchData.status === 'Submitted' && isAdmin && (
                    <Button
                      color="secondary"
                      variant="flat"
                      onPress={() => router.push(`/admin/batches/${resolvedParams.id}`)}
                    >
                      去审核
                    </Button>
                  )}
                  <BatchActionsDropdown
                    batchId={batchData.id}
                    status={batchData.status}
                    creatorId={batchData.creator.id}
                    onSuccess={mutate}
                    iconSize={18}
                  />
                </div>
              </div>
            </CardHeader>
            {batchData.sourceIssue && (
              <CardBody>
                <p className="text-small text-default-500 mb-1">关联 Issue:</p>
                <p className="font-medium">
                  #{batchData.sourceIssue.id} {batchData.sourceIssue.title}
                </p>
              </CardBody>
            )}
          </Card>

          {isDraftOwnedByViewer && (
            <Card className="mt-4 border-warning border-2 bg-warning-50/70 dark:bg-warning-100/5">
              <CardHeader className="pb-0">
                <h3 className="text-large font-bold text-warning flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  当前仍是草稿
                </h3>
              </CardHeader>
              <CardBody>
                <p className="text-default-700 font-medium">未提交，提交后才会进入审核流程！</p>
              </CardBody>
            </Card>
          )}

          {batchData.status === 'Rejected' && batchData.reviewNote && (
            <Card className="mt-4 border-danger border-2">
              <CardHeader className="pb-0">
                <h3 className="text-large font-bold text-danger flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  审核拒绝原因
                </h3>
              </CardHeader>
              <CardBody>
                <p className="text-default-600">{batchData.reviewNote}</p>
              </CardBody>
            </Card>
          )}

          {aiReview && batchData.status !== 'Draft' && (
            <Card className="mt-4">
              <CardBody className="space-y-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary dark:bg-primary-100/10">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">喵喵审核意见</h3>
                        <Chip color={getAiVerdictColor(aiReview.verdict)} variant="flat" size="sm">
                          {getAiVerdictText(aiReview.verdict)}
                        </Chip>
                      </div>
                      <p className="max-w-3xl text-small text-default-600">{aiReview.headline}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Chip size="sm" color="success" variant="flat">
                      通过 {aiReview.riskCounts.pass}
                    </Chip>
                    <Chip size="sm" color={humanReviewItems.length > 0 ? 'warning' : 'success'} variant="flat">
                      人看 {humanReviewItems.length}
                    </Chip>
                    <Chip size="sm" color="primary" variant="flat">
                      喵审 {aiReview.riskCounts.botReviewed}/{aiReview.items.length}
                    </Chip>
                  </div>
                </div>

                {humanReviewItems.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md bg-success-50 px-3 py-2 text-small text-success-700 dark:bg-success-100/10">
                    <CheckCircle2 className="h-4 w-4" />
                    本喵没有发现需要单独复核的条目。
                  </div>
                ) : (
                  <section className="rounded-lg border border-default-200 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <p className="font-medium">需要再看的条目</p>
                    </div>
                    <div className="space-y-2">
                      {humanReviewItems.map(item => (
                        <article key={item.prId} className={`rounded-md border px-3 py-2 ${getAiAlertClass(item)}`}>
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <Chip size="sm" color={item.severity} variant="flat">
                              PR#{item.prId}
                            </Chip>
                            <span className="text-small font-medium">{getReviewTargetLabel(item)}</span>
                            <span className="text-small text-default-500">{item.title}</span>
                          </div>
                          <p className="text-small text-default-700">{item.reasons[0]}</p>
                          {item.suggestions[0] && (
                            <p className="mt-1 text-small text-default-500">建议：{item.suggestions[0]}</p>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                {compactChainNotes.length > 0 && (
                  <div className="rounded-lg border border-default-200 bg-default-50/60 p-4 dark:bg-default-100/5">
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
              </CardBody>
            </Card>
          )}

          {batchData.pullRequests.length === 0 && canEdit && (
            <Card className="mt-4 border-warning border-2">
              <CardHeader className="pb-0">
                <h3 className="text-large font-bold text-warning flex items-center gap-2">
                  <Lightbulb className="w-5 h-5" />
                  提示
                </h3>
              </CardHeader>
              <CardBody>
                <p className="text-default-600">当前批次没有添加任何修改，不会在首页公众列表中展示。请添加修改后提交审核。</p>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <BatchPreview batchId={resolvedParams.id} />
          <BatchPRList
            pullRequests={batchData.pullRequests}
            canEdit={canEdit}
            onAddFirst={onOpen}
          />
        </div>
      </main>

      <CreatePRModal
        isOpen={isOpen}
        onClose={handleCloseModal}
        batchId={resolvedParams.id}
        batchPRs={batchData.pullRequests.length > 0 ? batchData.pullRequests.map(pr => ({
          id: pr.id,
          word: pr.word || '',
          oldWord: pr.oldWord || undefined,
          code: pr.code || '',
          action: pr.action,
          type: pr.type || undefined,
          weight: pr.weight || undefined,
          remark: pr.remark || undefined
        })) : undefined}
        onSuccess={() => {
          void mutate()
          void globalMutate((key: unknown) => Array.isArray(key) && key[0] === `/api/batches/${resolvedParams.id}/preview`)
        }}
      />
    </div>
  )
}
