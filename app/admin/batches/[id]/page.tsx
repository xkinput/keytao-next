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
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import Navbar from '@/app/components/Navbar'

interface PullRequest {
  id: number
  word: string | null
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
  weight: number | null
  remark: string | null
  hasConflict: boolean
  conflictReason: string | null
  phrase?: {
    id: number
    word: string
    code: string
  }
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
}

export default function AdminBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [reviewNote, setReviewNote] = useState('')
  const [processing, setProcessing] = useState(false)

  const { data: batch, error, isLoading, mutate } = useAPI<{ batch: BatchDetail }>(
    `/api/admin/batches/${resolvedParams.id}`
  )

  const handleApprove = async () => {
    if (!confirm('确定要批准这个批次吗？')) {
      return
    }

    setProcessing(true)
    try {
      await apiRequest(`/api/admin/batches/${resolvedParams.id}/approve`, {
        method: 'POST',
        body: { reviewNote: reviewNote || undefined }
      })
      alert('批次已批准')
      mutate()
      router.push('/admin/batches')
    } catch (err) {
      const error = err as Error
      alert(error.message || '批准失败')
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!reviewNote.trim()) {
      alert('拒绝时必须填写审核意见')
      return
    }

    if (!confirm('确定要拒绝这个批次吗？')) {
      return
    }

    setProcessing(true)
    try {
      await apiRequest(`/api/admin/batches/${resolvedParams.id}/reject`, {
        method: 'POST',
        body: { reviewNote }
      })
      alert('批次已拒绝')
      mutate()
      router.push('/admin/batches')
    } catch (err) {
      const error = err as Error
      alert(error.message || '拒绝失败')
    } finally {
      setProcessing(false)
    }
  }

  const getActionText = (action: string) => {
    const map: Record<string, string> = {
      Create: '新增',
      Change: '修改',
      Delete: '删除'
    }
    return map[action] || action
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

  if (isLoading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center">
          <Spinner size="lg" label="加载中..." />
        </div>
      </>
    )
  }

  if (error || !batch) {
    return (
      <>
        <Navbar />
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
      </>
    )
  }

  const batchData = batch.batch
  const canReview = batchData.status === 'Submitted'
  const hasConflicts = batchData.pullRequests.some(pr => pr.hasConflict)

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 dark:bg-none dark:bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Button
              variant="light"
              onPress={() => router.push('/admin/batches')}
              className="mb-4"
            >
              ← 返回列表
            </Button>

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
                        <Chip color="warning" variant="flat">
                          ⚠️ 包含冲突
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
                      {batchData.sourceIssue && (
                        <p>
                          关联 Issue: #{batchData.sourceIssue.id} {batchData.sourceIssue.title}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </div>

          <div className="space-y-4 mb-6">
            <h3 className="text-xl font-bold">
              修改列表 ({batchData.pullRequests.length})
            </h3>

            {batchData.pullRequests.map((pr) => (
              <Card key={pr.id}>
                <CardHeader className="flex justify-between">
                  <div className="flex items-center gap-2">
                    <Chip size="sm" variant="flat">
                      {getActionText(pr.action)}
                    </Chip>
                    <span className="font-semibold">
                      {pr.word || pr.phrase?.word}
                    </span>
                    <span className="text-default-500">→</span>
                    <code className="text-primary">{pr.code || pr.phrase?.code}</code>
                    {pr.weight && (
                      <span className="text-small text-default-400">
                        (权重: {pr.weight})
                      </span>
                    )}
                  </div>
                  {pr.hasConflict && (
                    <Chip color="warning" size="sm" variant="flat">
                      ⚠️ 冲突
                    </Chip>
                  )}
                </CardHeader>
                <CardBody>
                  {pr.remark && (
                    <div className="mb-3">
                      <p className="text-small text-default-500">备注: {pr.remark}</p>
                    </div>
                  )}

                  {pr.hasConflict && pr.conflictReason && (
                    <div className="mb-3 p-3 bg-warning-50 dark:bg-warning-100/10 rounded-lg">
                      <p className="text-small text-warning">{pr.conflictReason}</p>
                    </div>
                  )}

                  {pr.conflicts.length > 0 && (
                    <div className="mb-3">
                      <p className="text-small font-medium mb-2">冲突详情:</p>
                      {pr.conflicts.map((conflict, idx) => (
                        <div key={idx} className="text-small text-default-500 ml-4">
                          编码 &quot;{conflict.code}&quot; 被 &quot;{conflict.currentWord}&quot; 占用
                        </div>
                      ))}
                    </div>
                  )}

                  {pr.dependencies.length > 0 && (
                    <div>
                      <p className="text-small font-medium mb-2">依赖关系:</p>
                      {pr.dependencies.map((dep, idx) => (
                        <div key={idx} className="text-small text-default-500 ml-4">
                          • 依赖 PR#{dep.dependsOn.id}: {dep.dependsOn.word} - {dep.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>

          {canReview && (
            <Card>
              <CardHeader>
                <h3 className="text-xl font-bold">审核操作</h3>
              </CardHeader>
              <CardBody>
                <Textarea
                  label="审核意见"
                  placeholder={hasConflicts ? "批次包含冲突，拒绝时必须填写原因" : "可选，说明审核决定"}
                  value={reviewNote}
                  onValueChange={setReviewNote}
                  minRows={3}
                  className="mb-4"
                />

                {hasConflicts && (
                  <div className="mb-4 p-3 bg-warning-50 dark:bg-warning-100/10 rounded-lg">
                    <p className="text-small text-warning">
                      ⚠️ 警告: 该批次包含冲突的修改，建议仔细审核或拒绝
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
    </>
  )
}
