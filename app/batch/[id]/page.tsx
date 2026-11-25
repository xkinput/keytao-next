'use client'

import { use, useCallback, useMemo, useState, useEffect } from 'react'
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
} from '@/lib/heroui-compat'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { mutate as globalMutate } from 'swr'
import CreatePRModal from '@/app/components/CreatePRModal'
import BatchPreview from '@/app/components/BatchPreview'
import BatchItemVote, { useBatchItemVotes } from '@/app/components/BatchItemVote'
import ItemReviewDetail, { type ItemReviewDetailItem } from '@/app/components/ItemReviewDetail'
import BatchActionsDropdown from '@/app/components/BatchActionsDropdown'
import { useUIStore } from '@/lib/store/ui'
import { BATCH_STATUS_MAP, STATUS_COLOR_MAP } from '@/lib/constants/status'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import { formatBatchSubmitWarnings, type BatchSubmitWarning } from '@/lib/services/batchSubmitWarnings'
import { Edit, AlertTriangle, Lightbulb } from 'lucide-react'

type PullRequest = ItemReviewDetailItem & { appliedAt?: string | null }

interface BatchDetail {
  id: string
  contentVersion: number
  itemReviewStarted?: boolean
  reviewProgress?: { dependencyPendingIds: number[] }
  description: string
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected'
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
}

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const { user, isAdmin } = useAuthStore()
  const [submitting, setSubmitting] = useState(false)
  const [resubmittingId, setResubmittingId] = useState<number | null>(null)
  const [resubmittedVersions, setResubmittedVersions] = useState<{ batchId: string; from: number; to: number }>()
  const [editingName, setEditingName] = useState(false)
  const [batchName, setBatchName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { openAlert, openConfirm } = useUIStore()

  const { data: batch, error, isLoading, mutate } = useAPI<{ batch: BatchDetail }>(
    `/api/batches/${resolvedParams.id}`, { keepPreviousData: false },
  )

  const batchStatus = batch?.batch.status
  const votes = useBatchItemVotes(resolvedParams.id, batch?.batch.pullRequests.length ? batch.batch.contentVersion : undefined)
  const pullRequestById = useMemo(() => {
    return new Map((batch?.batch.pullRequests ?? []).map(pr => [pr.id, pr]))
  }, [batch?.batch.pullRequests])
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

  const refreshVoteContext = () => Promise.allSettled([
    mutate(),
    votes.refresh(),
    globalMutate((key: unknown) => Array.isArray(key) && key[0] === `/api/batches/${resolvedParams.id}/preview`),
  ])
  const refreshBatchDetails = useCallback(async () => {
    await mutate().catch(() => undefined)
  }, [mutate])

  const handleResubmitItem = async (itemId: number) => {
    if (!batch || resubmittingId !== null) return
    setResubmittingId(itemId)
    try {
      const from = batch.batch.contentVersion
      const { contentVersion } = await apiRequest<{ contentVersion: number }>(`/api/batches/${resolvedParams.id}/items/${itemId}/resubmit`, {
        method: 'POST',
        body: { expectedContentVersion: from },
        withAuth: true,
      })
      setResubmittedVersions(current => ({
        batchId: resolvedParams.id,
        from: current?.batchId === resolvedParams.id && current.to === from ? current.from : from,
        to: contentVersion,
      }))
      await refreshVoteContext()
      openAlert('词条已在原批次重新送审', '提交成功')
    } catch (error) {
      openAlert(error instanceof Error ? error.message : '重新送审失败', '出错了')
      await mutate()
    } finally {
      setResubmittingId(null)
    }
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

    const submitBatch = async (expectedContentVersion?: number, expectedWarningDigest?: string) => {
      setSubmitting(true)
      try {
        await apiRequest(`/api/batches/${resolvedParams.id}/submit`, {
          method: 'POST',
          body: expectedContentVersion === undefined
            ? undefined
            : { confirmed: true, expectedContentVersion, expectedWarningDigest },
          withAuth: true
        })
        await mutate()
        openAlert('批次已提交审核', '提交成功')
      } catch (err) {
        console.error('Submit batch error:', err)
        const error = err as Error & {
          info?: {
            error?: string
            requiresConfirmation?: boolean
            warnings?: BatchSubmitWarning[]
            batchId?: string
            contentVersion?: number
            warningDigest?: string
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
          const warningVersion = error.info.contentVersion
          const warningDigest = error.info.warningDigest
          if (!Number.isInteger(warningVersion) || warningVersion! < 0) {
            throw new Error('服务端未返回可确认的批次版本，请刷新后重试')
          }
          if (typeof warningDigest !== 'string' || !/^[a-f0-9]{64}$/.test(warningDigest)) {
            throw new Error('服务端未返回可确认的警告快照，请刷新后重试')
          }
          const message =
            '! 重要提示 - 请仔细阅读以下警告\n\n' +
            formatBatchSubmitWarnings(error.info.warnings, items).join('\n\n' + '─'.repeat(50) + '\n\n') +
            '\n\n确认要继续提交吗？'

          openConfirm(message, async () => {
            await submitBatch(warningVersion, warningDigest)
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

  if (!batch && isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size="lg" label="加载中..." />
      </div>
    )
  }

  if (!batch) {
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
  const canEdit = !batchData.itemReviewStarted && (isOwner || isAdmin) && editableStatuses.includes(batchData.status)
  const waitingOnDependencies = new Set(batchData.reviewProgress?.dependencyPendingIds)
  const reviewedFromContentVersion = resubmittedVersions?.batchId === batchData.id &&
    resubmittedVersions.to === batchData.contentVersion ? resubmittedVersions.from : undefined
  const votingOpen = batchData.status === 'Draft' || batchData.status === 'Submitted'
  const renderVote = (id: number, stale = false) => {
    const pr = pullRequestById.get(id)
    const tally = votes.byItem.get(id)
    if (!pr) return null
    return (
      <div className="flex h-8 w-24 shrink-0 items-center justify-end">
        {tally && !stale && (
          <BatchItemVote
            key={`${user?.id ?? 'guest'}:${id}`}
            batchId={batchData.id}
            itemId={id}
            viewerId={user?.id}
            label={pr.word || pr.phrase?.word || `词条 ${id}`}
            isOpen={votingOpen && pr.status === 'Pending' && !pr.appliedAt}
            contentVersion={batchData.contentVersion}
            vote={tally}
            onChange={votes.update}
            onStale={refreshVoteContext}
          />
        )}
      </div>
    )
  }
  const renderItem = (id: number, stale: boolean, previewRejection?: string, inDiff = false) => {
    const item = pullRequestById.get(id)
    if (!item) return null
    const canResubmit = isOwner && batchData.status !== 'Draft' && item.status === 'Rejected' && !item.appliedAt
    const rejectedReason = item.status === 'Rejected'
      ? item.reviewNotes?.find(note => note.decision === 'Rejected')?.reason || previewRejection
      : previewRejection
    return (
      <ItemReviewDetail publicView item={item} waitingOnDependencies={waitingOnDependencies.has(id)}
        rejectedReason={rejectedReason}
        actions={(
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-28 items-center justify-end">
              {canResubmit && (
                <Button size="sm" variant="flat" isDisabled={stale || resubmittingId !== null} isLoading={resubmittingId === id}
                  aria-label={`重新提交审核：${item.word ?? item.code ?? id}`} onPress={() => void handleResubmitItem(id)}>
                  重新提交审核
                </Button>
              )}
            </div>
            {!inDiff && renderVote(id)}
          </div>
        )} />
    )
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
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBatchName(e.target.value)}
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
                      {batchData.pullRequests.length > 0 && batchData.status !== 'Submitted' && (
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
                  {!batchData.itemReviewStarted && <BatchActionsDropdown
                    batchId={batchData.id}
                    status={batchData.status}
                    creatorId={batchData.creator.id}
                    onSuccess={mutate}
                    iconSize={18}
                  />}
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
          <BatchPreview batchId={resolvedParams.id} expectedContentVersion={batchData.contentVersion}
            reviewedFromContentVersion={reviewedFromContentVersion} onNewerReviewPreview={refreshBatchDetails}
            reviewItems={batchData.pullRequests} renderReviewItem={renderItem} renderLineActions={renderVote}
            onAddFirst={canEdit && batchData.pullRequests.length === 0 ? onOpen : undefined} />
          {votes.error && <p role="status" className="text-sm text-danger">社区投票暂时无法加载</p>}
        </div>
      </main>

      <CreatePRModal
        isOpen={isOpen}
        onClose={handleCloseModal}
        batchId={resolvedParams.id}
        batchContentVersion={batchData.contentVersion}
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
        onSuccess={() => void refreshVoteContext()}
      />
    </div>
  )
}
