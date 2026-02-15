'use client'

import { useState, useEffect } from 'react'
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
import { useAPI } from '@/lib/hooks/useSWR'
import { usePageFilterStore } from '@/lib/store/pageFilter'

interface PullRequest {
  id: number
  word: string | null
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
  status: 'Pending' | 'Approved' | 'Rejected'
  hasConflict: boolean
  conflictInfo?: {
    hasConflict: boolean
    conflicts?: any[]
  }
  createAt: string
  user: {
    id: number
    name: string
    nickname: string | null
  }
  batch?: {
    id: string
    description: string
    status: string
  }
  phrase?: {
    word: string
    code: string
  }
  _count: {
    dependencies: number
    dependedBy: number
  }
}

interface PRResponse {
  pullRequests: PullRequest[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default function PullRequestsPage() {
  const { getFilter, setFilter, getPage, setPage: setStorePage } = usePageFilterStore()
  const [status, setStatus] = useState<string>(() => getFilter('/pull-requests', 'all'))
  const [page, setPage] = useState(() => getPage('/pull-requests', 1))

  // Sync status changes to store (resets page to 1)
  useEffect(() => {
    setFilter('/pull-requests', status)
  }, [status, setFilter])

  // Sync page changes to store
  useEffect(() => {
    setStorePage('/pull-requests', page)
  }, [page, setStorePage])

  const statusParam = status === 'all' ? '' : `&status=${status}`
  const { data, error, isLoading } = useAPI<PRResponse>(
    `/api/pull-requests?page=${page}&pageSize=10${statusParam}`
  )

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
      case 'Pending':
        return 'primary'
      case 'Approved':
        return 'success'
      case 'Rejected':
        return 'danger'
      default:
        return 'default'
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size="lg" label="加载中..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <Card className="max-w-md">
          <CardBody className="text-center">
            <p className="text-danger mb-4">加载失败</p>
            <p className="text-default-500">{error.message}</p>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold mb-2">修改提议</h2>
            <p className="text-default-500">
              共 {data?.pagination.total || 0} 个提议
            </p>
          </div>
        </div>

        <Tabs
          selectedKey={status}
          onSelectionChange={(key) => setStatus(key as string)}
          className="mb-6"
        >
          <Tab key="all" title="全部" />
          <Tab key="Pending" title="待审核" />
          <Tab key="Approved" title="已通过" />
          <Tab key="Rejected" title="已拒绝" />
        </Tabs>

        <div className="grid gap-4">
          {data?.pullRequests.map((pr) => (
            <Card key={pr.id} isPressable as={Link} href={`/pull-requests/${pr.id}`}>
              <CardHeader className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <Chip size="sm" variant="flat">
                    {getActionText(pr.action)}
                  </Chip>
                  <span className="font-semibold">
                    {pr.word || pr.phrase?.word}
                  </span>
                  <span className="text-default-500">→</span>
                  <code className="text-primary">{pr.code || pr.phrase?.code}</code>
                </div>
                <div className="flex items-center gap-2">
                  {(pr.conflictInfo?.hasConflict ?? pr.hasConflict) && (
                    <Chip color="warning" size="sm" variant="flat">
                      ⚠️ 冲突
                    </Chip>
                  )}
                  <Chip
                    color={getStatusColor(pr.status)}
                    size="sm"
                    variant="flat"
                  >
                    {pr.status}
                  </Chip>
                </div>
              </CardHeader>
              <CardBody>
                <div className="flex items-center gap-4 text-small text-default-500">
                  <span>
                    由 {pr.user.nickname || pr.user.name} 创建于{' '}
                    {new Date(pr.createAt).toLocaleString('zh-CN')}
                  </span>
                  {pr.batch && (
                    <span className="text-primary">
                      批次: {pr.batch.description}
                    </span>
                  )}
                  {(pr._count.dependencies > 0 || pr._count.dependedBy > 0) && (
                    <span>
                      🔗 {pr._count.dependencies + pr._count.dependedBy} 个依赖
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}

          {data?.pullRequests.length === 0 && (
            <Card>
              <CardBody className="text-center py-12">
                <p className="text-default-500">暂无修改提议</p>
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
  )
}
