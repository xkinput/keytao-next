'use client'

import { useState } from 'react'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip,
  Progress,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Pagination,
} from '@heroui/react'
import Navbar from '@/app/components/Navbar'
import { useAPI } from '@/lib/hooks/useSWR'
import { useAuthStore } from '@/lib/store/auth'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

interface SyncTask {
  id: string
  status: 'Pending' | 'Running' | 'Completed' | 'Failed'
  progress: number
  message: string | null
  error: string | null
  pullRequestUrl: string | null
  createAt: string
  startAt: string | null
  completeAt: string | null
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

export default function SyncPage() {
  const { token } = useAuthStore()
  const [currentPage, setCurrentPage] = useState(1)
  const [isTriggering, setIsTriggering] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)

  // Get sync tasks with pagination
  const {
    data: tasksData,
    isLoading,
    mutate,
  } = useAPI<TasksResponse>(
    token ? `/api/admin/sync-to-github/tasks?page=${currentPage}&pageSize=10` : null
  )

  // Get running task (if any)
  const runningTask = tasksData?.tasks?.find(
    (task) => task.status === 'Running' || task.status === 'Pending'
  )

  const handleTriggerSync = async () => {
    setIsTriggering(true)
    setTriggerError(null)

    try {
      const response = await fetch('/api/admin/sync-to-github/trigger', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '触发同步失败')
      }

      // Refresh task list
      mutate()
    } catch (error) {
      setTriggerError(error instanceof Error ? error.message : '触发同步失败')
    } finally {
      setIsTriggering(false)
    }
  }

  const getStatusChip = (status: SyncTask['status']) => {
    const config = {
      Pending: { color: 'warning' as const, text: '等待中' },
      Running: { color: 'primary' as const, text: '运行中' },
      Completed: { color: 'success' as const, text: '已完成' },
      Failed: { color: 'danger' as const, text: '失败' },
    }
    const { color, text } = config[status]
    return <Chip color={color}>{text}</Chip>
  }

  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return format(new Date(date), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN })
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

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">GitHub 同步管理</h1>
            <Button
              color="primary"
              onPress={handleTriggerSync}
              isLoading={isTriggering}
              isDisabled={!!runningTask}
            >
              触发同步
            </Button>
          </div>

          {triggerError && (
            <Card className="mb-6 bg-danger-50 border-danger">
              <CardBody>
                <p className="text-danger">{triggerError}</p>
              </CardBody>
            </Card>
          )}

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

                  {runningTask.startAt && (
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-default-600">开始时间:</span>
                      <span className="text-sm">{formatDate(runningTask.startAt)}</span>
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
              {tasksData && tasksData.tasks && tasksData.tasks.length > 0 ? (
                <>
                  <Table aria-label="同步任务历史">
                    <TableHeader>
                      <TableColumn>任务 ID</TableColumn>
                      <TableColumn>状态</TableColumn>
                      <TableColumn>进度</TableColumn>
                      <TableColumn>创建时间</TableColumn>
                      <TableColumn>完成时间</TableColumn>
                      <TableColumn>批次数</TableColumn>
                      <TableColumn>操作</TableColumn>
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
                            <span className="text-xs">{formatDate(task.completeAt)}</span>
                          </TableCell>
                          <TableCell>{task.batches.length}</TableCell>
                          <TableCell>
                            {task.pullRequestUrl && (
                              <Button
                                size="sm"
                                variant="light"
                                color="primary"
                                as="a"
                                href={task.pullRequestUrl}
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
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {tasksData.pagination.totalPages > 1 && (
                    <div className="flex justify-center mt-6">
                      <Pagination
                        total={tasksData.pagination.totalPages}
                        page={currentPage}
                        onChange={setCurrentPage}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-default-400">暂无同步历史</div>
              )}
            </CardBody>
          </Card>
        </main>
      </div>
    </>
  )
}
