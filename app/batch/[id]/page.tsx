'use client'

import { use, useState, useEffect } from 'react'
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
import Navbar from '@/app/components/Navbar'
import CreatePRModal from '@/app/components/CreatePRModal'

interface PullRequest {
  id: number
  word: string | null
  oldWord?: string | null
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
  type?: string | null
  status: string
  weight: number | null
  remark: string | null
  hasConflict: boolean
  conflictReason: string | null
  phrase?: {
    id: number
    word: string
    code: string
  }
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
  creator: {
    id: number
    name: string
    nickname: string | null
  }
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
  const { user } = useAuthStore()
  const [submitting, setSubmitting] = useState(false)
  const [editingPR, setEditingPR] = useState<PullRequest | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [batchName, setBatchName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()

  const { data: batch, error, isLoading, mutate } = useAPI<{ batch: BatchDetail }>(
    `/api/batches/${resolvedParams.id}`
  )

  // Initialize batch name when data loads
  useEffect(() => {
    if (batch?.batch.description) {
      setBatchName(batch.batch.description)
    }
  }, [batch?.batch.description])

  const handleSaveName = async () => {
    if (!batchName.trim()) {
      alert('批次名称不能为空')
      return
    }

    setSavingName(true)
    try {
      await apiRequest(`/api/batches/${resolvedParams.id}`, {
        method: 'PATCH',
        body: { description: batchName }
      })
      await mutate()
      setEditingName(false)
    } catch (err) {
      const error = err as Error
      alert(error.message || '保存失败')
    } finally {
      setSavingName(false)
    }
  }

  const handleCancelEditName = () => {
    setBatchName(batch?.batch.description || '')
    setEditingName(false)
  }

  const handleEdit = (pr: PullRequest) => {
    setEditingPR(pr)
    onOpen()
  }

  const handleCloseModal = () => {
    setEditingPR(null)
    onClose()
  }

  const handleDelete = async (prId: number) => {
    if (!confirm('确定要删除这个修改提议吗？')) {
      return
    }

    try {
      await apiRequest(`/api/pull-requests/${prId}`, {
        method: 'DELETE'
      })
      mutate()
    } catch (err) {
      const error = err as Error
      alert(error.message || '删除失败')
    }
  }

  const handleSubmit = async () => {
    if (!batch) return

    setSubmitting(true)
    try {
      await apiRequest(`/api/batches/${resolvedParams.id}/submit`, {
        method: 'POST'
      })
      alert('批次已提交审核')
      mutate()
    } catch (err) {
      const error = err as Error
      alert(error.message || '提交失败')
    } finally {
      setSubmitting(false)
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
      case 'Draft':
        return 'default'
      case 'Submitted':
        return 'primary'
      case 'Approved':
        return 'success'
      case 'Rejected':
        return 'danger'
      case 'Published':
        return 'secondary'
      default:
        return 'default'
    }
  }

  if (isLoading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Spinner size="lg" label="加载中..." />
        </div>
      </>
    )
  }

  if (error || !batch) {
    return (
      <>
        <Navbar />
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
      </>
    )
  }

  const batchData = batch.batch
  const isOwner = user?.id === batchData.creator.id
  const canEdit = isOwner && batchData.status === 'Draft'

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 dark:bg-none dark:bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Button
              variant="light"
              onPress={() => router.push('/')}
              className="mb-4"
            >
              ← 返回列表
            </Button>

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
                              ✏️
                            </Button>
                          )}
                        </>
                      )}
                      <Chip
                        color={getStatusColor(batchData.status)}
                        variant="flat"
                      >
                        {batchData.status}
                      </Chip>
                    </div>
                    <p className="text-small text-default-500">
                      由 {batchData.creator.nickname || batchData.creator.name} 创建于{' '}
                      {new Date(batchData.createAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <Button color="primary" onPress={onOpen}>
                        添加修改
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
                    </div>
                  )}
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
          </div>

          <div className="space-y-4">
            <h3 className="text-xl font-bold">
              修改列表 ({batchData.pullRequests.length})
            </h3>

            {batchData.pullRequests.length === 0 ? (
              <Card>
                <CardBody className="text-center py-12">
                  <p className="text-default-500 mb-4">还没有添加任何修改</p>
                  {canEdit && (
                    <Button color="primary" onPress={onOpen}>
                      添加第一个修改
                    </Button>
                  )}
                </CardBody>
              </Card>
            ) : (
              batchData.pullRequests.map((pr) => (
                <Card key={pr.id}>
                  <CardHeader className="flex justify-between">
                    <div className="flex items-center gap-2">
                      <Chip size="sm" variant="flat">
                        {getActionText(pr.action)}
                      </Chip>
                      {pr.action === 'Change' && pr.oldWord ? (
                        <>
                          <span className="text-default-500 line-through">{pr.oldWord}</span>
                          <span className="text-default-500">→</span>
                          <span className="font-semibold">{pr.word}</span>
                          <span className="text-default-500">@</span>
                          <code className="text-primary">{pr.code}</code>
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">
                            {pr.word || pr.phrase?.word}
                          </span>
                          <span className="text-default-500">→</span>
                          <code className="text-primary">{pr.code || pr.phrase?.code}</code>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {pr.hasConflict && (
                        <Chip color="warning" size="sm" variant="flat">
                          ⚠️ 冲突
                        </Chip>
                      )}
                      {canEdit && (
                        <>
                          <Button
                            size="sm"
                            variant="light"
                            onPress={() => handleEdit(pr)}
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="light"
                            color="danger"
                            onPress={() => handleDelete(pr.id)}
                          >
                            删除
                          </Button>
                        </>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody>
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
                      <div className="mb-3">
                        <p className="text-small font-medium mb-2">依赖于:</p>
                        {pr.dependencies.map((dep, idx) => (
                          <div key={idx} className="text-small text-default-500 ml-4">
                            • PR#{dep.dependsOn.id}: {dep.dependsOn.word} ({dep.reason})
                          </div>
                        ))}
                      </div>
                    )}

                    {pr.dependedBy.length > 0 && (
                      <div>
                        <p className="text-small font-medium mb-2">被依赖:</p>
                        {pr.dependedBy.map((dep, idx) => (
                          <div key={idx} className="text-small text-default-500 ml-4">
                            • PR#{dep.dependent.id}: {dep.dependent.word} ({dep.reason})
                          </div>
                        ))}
                      </div>
                    )}
                  </CardBody>
                </Card>
              ))
            )}
          </div>
        </main>

        <CreatePRModal
          isOpen={isOpen}
          onClose={handleCloseModal}
          batchId={resolvedParams.id}
          editPR={editingPR ? {
            id: editingPR.id,
            word: editingPR.word || '',
            oldWord: editingPR.oldWord || undefined,
            code: editingPR.code || '',
            action: editingPR.action,
            type: editingPR.type || undefined,
            weight: editingPR.weight || undefined,
            remark: editingPR.remark || undefined
          } : undefined}
          onSuccess={mutate}
        />
      </div>
    </>
  )
}
