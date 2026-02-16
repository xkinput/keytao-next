'use client'

import { useState } from 'react'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  Progress,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Pagination,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Link,
  Skeleton,
} from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'
import { useAuthStore } from '@/lib/store/auth'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { SyncProgressModal } from '@/app/components/SyncProgressModal'

interface SyncTask {
  id: string
  status: 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Cancelled'
  progress: number
  message: string | null
  error: string | null
  githubPrUrl: string | null
  createAt: string
  startedAt: string | null
  completedAt: string | null
  batches: Array<{
    id: string
    description: string
  }>
}

interface TasksResponse {
  tasks: SyncTask[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

interface StatsResponse {
  totalPhrases: number
  totalIssues: number
  totalUsers: number
  totalPullRequests: number
  pendingSyncBatches: number
}

export default function SyncPage() {
  const { token } = useAuthStore()
  const [currentPage, setCurrentPage] = useState(1)
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [retryTaskId, setRetryTaskId] = useState<string | undefined>(undefined)
  const [selectedTask, setSelectedTask] = useState<SyncTask | null>(null)
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false)
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null)

  // Check if user is admin
  const { data: adminCheck } = useAPI('/api/admin/stats')
  const isAdmin = !!adminCheck

  // Get sync tasks with pagination (public access, no auth required)
  const {
    data: tasksData,
    error: tasksError,
    isLoading,
    mutate,
  } = useAPI<TasksResponse>(
    `/api/admin/sync-to-github/tasks?page=${currentPage}&pageSize=10`,
    { withAuth: false }
  )

  // Get stats including pending sync batches count
  const { data: statsData, mutate: mutateStats } = useAPI<StatsResponse>(
    '/api/admin/stats'
  )

  // Get running task (if any)
  const runningTask = tasksData?.tasks?.find(
    (task) => task.status === 'Running' || task.status === 'Pending'
  )

  const showSkeleton = isLoading && !tasksData

  const handleTriggerSync = () => {
    setIsSyncModalOpen(true)
  }

  const handleSyncComplete = () => {
    // Refresh task list and stats
    mutate()
    mutateStats()
  }

  const getStatusChip = (status: SyncTask['status']) => {
    const config = {
      Pending: { color: 'warning' as const, text: '等待中' },
      Running: { color: 'primary' as const, text: '运行中' },
      Completed: { color: 'success' as const, text: '已完成' },
      Failed: { color: 'danger' as const, text: '失败' },
      Cancelled: { color: 'default' as const, text: '已取消' },
    }
    const { color, text } = config[status]
    return <Chip color={color}>{text}</Chip>
  }

  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return format(new Date(date), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN })
  }

  const handleOpenBatchModal = (task: SyncTask) => {
    setSelectedTask(task)
    setIsBatchModalOpen(true)
  }

  const handleCloseBatchModal = () => {
    setIsBatchModalOpen(false)
    setTimeout(() => setSelectedTask(null), 300)
  }

  const handleCancelTask = async (taskId: string, taskProgress: number) => {
    // Show confirmation with warning based on progress
    const needsCleanup = taskProgress >= 70
    const warningMessage = needsCleanup
      ? '任务正在进行文件提交，取消后可能需要手动清理 GitHub 上的分支。\n\n确定要取消吗？'
      : '确定要取消这个同步任务吗？'

    if (!confirm(warningMessage)) {
      return
    }

    setCancellingTaskId(taskId)

    try {
      const response = await fetch(`/api/admin/sync-to-github/cancel/${taskId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '取消任务失败')
      }

      // Show cleanup note if needed
      if (result.needsCleanup && result.cleanupNote) {
        alert(`任务已取消\n\n⚠️ ${result.cleanupNote}`)
      }

      // Refresh task list
      mutate()
      mutateStats()
    } catch (error) {
      alert(error instanceof Error ? error.message : '取消任务失败')
    } finally {
      setCancellingTaskId(null)
    }
  }

  const handleRetryTask = (taskId: string) => {
    // Open sync progress modal in retry mode
    setRetryTaskId(taskId)
    setIsSyncModalOpen(true)
  }

  const syncTableColumns = [
    '任务 ID',
    '状态',
    '进度',
    '创建时间',
    '完成时间',
    '批次数',
    '操作',
  ]

  return (
    <div className="min-h-screen">
      <div className="min-h-screen">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">GitHub 同步管理</h1>
            <div className="flex items-center gap-4">
              {statsData && isAdmin && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-default-600">待同步批次:</span>
                  <Chip
                    color={statsData.pendingSyncBatches > 0 ? "warning" : "default"}
                    variant="flat"
                    size="sm"
                  >
                    {statsData.pendingSyncBatches > 0 ? `${statsData.pendingSyncBatches} 个` : '无待同步批次'}
                  </Chip>
                </div>
              )}
              <Button
                isIconOnly
                variant="flat"
                size="sm"
                onPress={() => {
                  mutate()
                  mutateStats()
                }}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              {isAdmin && (
                <Button
                  color="primary"
                  onPress={handleTriggerSync}
                  isDisabled={!!runningTask || !statsData || statsData.pendingSyncBatches === 0}
                >
                  同步到 GitHub
                </Button>
              )}
            </div>
          </div>

          {/* Current Sync Status */}
          {runningTask && (
            <Card className="mb-6">
              <CardHeader>
                <h2 className="text-xl font-semibold">当前同步状态</h2>
              </CardHeader>
              <CardBody>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-default-600">任务 ID:</span>
                    <code className="text-sm">{runningTask.id}</code>
                    {getStatusChip(runningTask.status)}
                  </div>

                  {runningTask.status === 'Running' && (
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-default-600">同步进度</span>
                        <span className="text-sm font-semibold">{runningTask.progress}%</span>
                      </div>
                      <Progress
                        value={runningTask.progress}
                        color="primary"
                        className="max-w-full"
                      />
                    </div>
                  )}

                  {runningTask.message && (
                    <div>
                      <span className="text-sm text-default-600">当前消息:</span>
                      <p className="text-sm mt-1">{runningTask.message}</p>
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <span className="text-sm text-default-600">创建时间:</span>
                    <span className="text-sm">{formatDate(runningTask.createAt)}</span>
                  </div>

                  {runningTask.startedAt && (
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-default-600">开始时间:</span>
                      <span className="text-sm">{formatDate(runningTask.startedAt)}</span>
                    </div>
                  )}

                  {runningTask.batches.length > 0 && (
                    <div>
                      <span className="text-sm text-default-600">包含批次:</span>
                      <div className="mt-2 space-y-1">
                        {runningTask.batches.map((batch) => (
                          <div key={batch.id} className="text-sm">
                            • {batch.description}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Sync History */}
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">同步历史</h2>
            </CardHeader>
            <CardBody>
              {showSkeleton ? (
                <Table aria-label="同步任务历史">
                  <TableHeader>
                    {syncTableColumns.map((column, index) => (
                      <TableColumn key={index}>{column}</TableColumn>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={`skeleton-${i}`}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full rounded-lg" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : tasksError ? (
                <div className="text-center py-12">
                  <p className="text-danger mb-4">加载失败</p>
                  <Button
                    color="primary"
                    variant="flat"
                    onPress={() => mutate()}
                  >
                    重试
                  </Button>
                </div>
              ) : tasksData && tasksData.tasks && tasksData.tasks.length > 0 ? (
                <Table aria-label="同步任务历史">
                  <TableHeader>
                    {syncTableColumns.map((column, index) => (
                      <TableColumn key={index}>{column}</TableColumn>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {tasksData.tasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell>
                          <code className="text-xs">{task.id.slice(0, 8)}...</code>
                        </TableCell>
                        <TableCell>{getStatusChip(task.status)}</TableCell>
                        <TableCell>
                          {task.status === 'Running' || task.status === 'Completed' ? (
                            <span>{task.progress}%</span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">{formatDate(task.createAt)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">{formatDate(task.completedAt)}</span>
                        </TableCell>
                        <TableCell>
                          {task.batches.length > 0 ? (
                            <Button
                              size="sm"
                              variant="light"
                              color="primary"
                              onPress={() => handleOpenBatchModal(task)}
                            >
                              {task.batches.length} 个批次
                            </Button>
                          ) : (
                            <span className="text-default-400">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {task.githubPrUrl && (
                              <Button
                                size="sm"
                                variant="light"
                                color="primary"
                                as="a"
                                href={task.githubPrUrl}
                                target="_blank"
                              >
                                查看 PR
                              </Button>
                            )}
                            {task.error && (
                              <Button
                                size="sm"
                                variant="light"
                                color="danger"
                                onPress={() => alert(task.error)}
                              >
                                查看错误
                              </Button>
                            )}
                            {(task.status === 'Pending' || task.status === 'Running') && isAdmin && (
                              <Button
                                size="sm"
                                variant="light"
                                color="warning"
                                onPress={() => handleCancelTask(task.id, task.progress)}
                                isLoading={cancellingTaskId === task.id}
                              >
                                取消
                              </Button>
                            )}
                            {(task.status === 'Failed' || task.status === 'Cancelled') && isAdmin && (
                              <Button
                                size="sm"
                                variant="light"
                                color="success"
                                onPress={() => handleRetryTask(task.id)}
                              >
                                重试
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 text-default-400">暂无同步历史</div>
              )}

              {tasksData && tasksData.pagination.totalPages > 1 && (
                <div className="flex justify-center mt-6">
                  <Pagination
                    total={tasksData.pagination.totalPages}
                    page={currentPage}
                    onChange={setCurrentPage}
                  />
                </div>
              )}
            </CardBody>
          </Card>

          {/* Batch Modal */}
          <Modal
            isOpen={isBatchModalOpen}
            onClose={handleCloseBatchModal}
            size="2xl"
            scrollBehavior="inside"
          >
            <ModalContent>
              <ModalHeader className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold">包含的批次</h3>
                {selectedTask && (
                  <p className="text-sm text-default-500 font-normal">
                    任务 ID: {selectedTask.id.slice(0, 8)}...
                  </p>
                )}
              </ModalHeader>
              <ModalBody>
                {selectedTask && selectedTask.batches.length > 0 ? (
                  <div className="space-y-3">
                    {selectedTask.batches.map((batch, index) => (
                      <Card key={batch.id} className="border-1 border-default-200 shadow-sm">
                        <CardBody className="py-3">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs text-default-500">
                                  批次 #{index + 1}
                                </span>
                                <code className="text-xs text-default-400">
                                  {batch.id.slice(0, 8)}...
                                </code>
                              </div>
                              <p className="text-sm font-medium text-default-700 truncate">
                                {batch.description || '无描述'}
                              </p>
                            </div>
                            <Button
                              as={Link}
                              href={`/batch/${batch.id}`}
                              size="sm"
                              color="primary"
                              variant="flat"
                              className="ml-4 shrink-0"
                            >
                              查看详情
                            </Button>
                          </div>
                        </CardBody>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-default-400">
                    该任务没有关联的批次
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button color="default" variant="light" onPress={handleCloseBatchModal}>
                  关闭
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>

          {/* Sync Progress Modal */}
          <SyncProgressModal
            isOpen={isSyncModalOpen}
            onClose={() => {
              setIsSyncModalOpen(false)
              setRetryTaskId(undefined)
            }}
            token={token || ''}
            onComplete={handleSyncComplete}
            retryTaskId={retryTaskId}
          />
        </main>
      </div>
    </div>
  )
}
