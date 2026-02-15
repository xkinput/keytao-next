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
  Input,
  Tabs,
  Tab
} from '@heroui/react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import Navbar from '@/app/components/Navbar'
import CreatePRModal from '@/app/components/CreatePRModal'
import BatchPreview from '@/app/components/BatchPreview'
import BatchPRList from '@/app/components/BatchPRList'
import BatchActionsDropdown from '@/app/components/BatchActionsDropdown'
import { useUIStore } from '@/lib/store/ui'

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
  const { user, token, isAuthenticated } = useAuthStore()
  const [submitting, setSubmitting] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [batchName, setBatchName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { openAlert, openConfirm } = useUIStore()

  const { data: batch, error, isLoading, mutate } = useAPI<{ batch: BatchDetail }>(
    `/api/batches/${resolvedParams.id}`
  )

  // Check if user is admin
  const { data: adminCheck } = useAPI(
    isAuthenticated() && token ? '/api/admin/stats' : null
  )
  const isAdmin = !!adminCheck

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

  const handleDelete = async () => {
    try {
      await apiRequest(`/api/batches/${resolvedParams.id}`, {
        method: 'DELETE',
        withAuth: true
      })
      toast.success('批次已删除')
      router.push('/')
    } catch (err) {
      const error = err as Error
      openAlert(error.message || '删除失败', '出错了')
    }
  }

  const handleWithdraw = async () => {
    try {
      await apiRequest(`/api/batches/${resolvedParams.id}/withdraw`, {
        method: 'POST',
        withAuth: true
      })
      toast.success('已撤销提交')
      await mutate()
    } catch (err) {
      const error = err as Error
      openAlert(error.message || '撤销失败', '出错了')
    }
  }



  const handleSubmit = async () => {
    if (!batch) return

    openConfirm('确定要提交审核吗？', async () => {
      setSubmitting(true)
      try {
        await apiRequest(`/api/batches/${resolvedParams.id}/submit`, {
          method: 'POST',
          withAuth: true
        })
        openAlert('批次已提交审核', '提交成功')
        await mutate()
      } catch (err) {
        console.error('Submit batch error:', err)
        const error = err as Error & {
          info?: {
            error?: string
            conflicts?: Array<{
              hasConflict: boolean
              code: string
              impact?: string
              currentPhrase?: { word: string }
            }>
          }
          status?: number
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
    }, '提交审核', '提交')
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
  const canEdit = isOwner && (batchData.status === 'Draft' || batchData.status === 'Rejected')

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

            {batchData.status === 'Rejected' && batchData.reviewNote && (
              <Card className="mt-4 border-danger border-2">
                <CardHeader className="pb-0">
                  <h3 className="text-large font-bold text-danger">⚠️ 审核拒绝原因</h3>
                </CardHeader>
                <CardBody>
                  <p className="text-default-600">{batchData.reviewNote}</p>
                </CardBody>
              </Card>
            )}

            {batchData.pullRequests.length === 0 && canEdit && (
              <Card className="mt-4 border-warning border-2">
                <CardHeader className="pb-0">
                  <h3 className="text-large font-bold text-warning">💡 提示</h3>
                </CardHeader>
                <CardBody>
                  <p className="text-default-600">当前批次没有添加任何修改，不会在首页公众列表中展示。请添加修改后提交审核。</p>
                </CardBody>
              </Card>
            )}
          </div>

          <Tabs aria-label="批次视图" className="mb-4">
            <Tab key="list" title={`📝 修改列表 (${batchData.pullRequests.length})`}>
              <BatchPRList
                pullRequests={batchData.pullRequests}
                canEdit={canEdit}
                onAddFirst={onOpen}
              />
            </Tab>
            <Tab key="preview" title="👁️ 预览执行">
              <div className="pt-4">
                <BatchPreview batchId={resolvedParams.id} />
              </div>
            </Tab>
          </Tabs>
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
          onSuccess={() => void mutate()}
        />
      </div>
    </>
  )
}
