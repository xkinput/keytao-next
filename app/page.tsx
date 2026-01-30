'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip,
  Tabs,
  Tab
} from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI } from '@/lib/hooks/useSWR'
import Navbar from '@/app/components/Navbar'

interface Batch {
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
  }
  pullRequests: Array<{
    id: number
    status: string
    hasConflict: boolean
  }>
  _count: {
    pullRequests: number
  }
}

interface BatchesResponse {
  batches: Batch[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default function BatchesPage() {
  const { isAuthenticated } = useAuthStore()
  const [status, setStatus] = useState<string>('all')
  const [page, setPage] = useState(1)

  const statusParam = status === 'all' ? '' : `&status=${status}`
  const { data, error, isLoading } = useAPI<BatchesResponse>(
    isAuthenticated() ? `/api/batches?page=${page}&pageSize=10${statusParam}` : null
  )

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

  const getStatusText = (status: string) => {
    const map: Record<string, string> = {
      Draft: '草稿',
      Submitted: '已提交',
      Approved: '已通过',
      Rejected: '已拒绝',
      Published: '已发布'
    }
    return map[status] || status
  }

  if (!isAuthenticated()) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Card>
            <CardBody className="text-center">
              <p className="text-default-500 mb-4">请先登录</p>
              <Button as={Link} href="/login" color="primary">
                去登录
              </Button>
            </CardBody>
          </Card>
        </div>
      </>
    )
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

  if (error) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <Card className="max-w-md">
            <CardBody className="text-center">
              <p className="text-danger mb-4">加载失败</p>
              <p className="text-default-500">{error.message}</p>
            </CardBody>
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 dark:bg-none dark:bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">改词</h2>
              <p className="text-default-500">
                共 {data?.pagination.total || 0} 个
              </p>
            </div>
            <Button
              as={Link}
              href="/batch/new"
              color="primary"
            >
              新建
            </Button>
          </div>

          <Tabs
            selectedKey={status}
            onSelectionChange={(key) => setStatus(key as string)}
            className="mb-6"
          >
            <Tab key="all" title="全部" />
            <Tab key="Draft" title="草稿" />
            <Tab key="Submitted" title="待审核" />
            <Tab key="Approved" title="已通过" />
            <Tab key="Published" title="已发布" />
          </Tabs>

          <div className="grid gap-4">
            {data?.batches.map((batch) => (
              <Card key={batch.id} isPressable as={Link} href={`/batch/${batch.id}`}>
                <CardHeader className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold">
                        {batch.description || '未命名批次'}
                      </h3>
                      <Chip
                        color={getStatusColor(batch.status)}
                        size="sm"
                        variant="flat"
                      >
                        {getStatusText(batch.status)}
                      </Chip>
                    </div>
                    <p className="text-small text-default-500">
                      由 {batch.creator.nickname || batch.creator.name} 创建于{' '}
                      {new Date(batch.createAt).toLocaleString('zh-CN')}
                    </p>
                    {batch.sourceIssue && (
                      <p className="text-small text-primary mt-1">
                        关联讨论: #{batch.sourceIssue.id} {batch.sourceIssue.title}
                      </p>
                    )}
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="flex items-center gap-4 text-small text-default-500">
                    <span>📝 {batch._count.pullRequests} 个修改</span>
                    {batch.pullRequests.some((pr) => pr.hasConflict) && (
                      <Chip color="warning" size="sm" variant="flat">
                        ⚠️ 有冲突
                      </Chip>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}

            {data?.batches.length === 0 && (
              <Card>
                <CardBody className="text-center py-12">
                  <p className="text-default-500">暂无批次</p>
                </CardBody>
              </Card>
            )}
          </div>

          {data?.pagination && data.pagination.totalPages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              <Button
                isDisabled={data.pagination.page === 1}
                onPress={() => setPage(data.pagination.page - 1)}
              >
                上一页
              </Button>
              <span className="flex items-center px-4">
                {data.pagination.page} / {data.pagination.totalPages}
              </span>
              <Button
                isDisabled={data.pagination.page === data.pagination.totalPages}
                onPress={() => setPage(data.pagination.page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
