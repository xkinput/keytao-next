'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  Tabs,
  Tab
} from '@heroui/react'
import { RefreshCw, AlertTriangle, Link as LinkIcon } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'
import { usePageFilterStore } from '@/lib/store/pageFilter'
import PullRequestCardSkeleton from '@/app/components/PullRequestCardSkeleton'
import { PR_STATUS_MAP, STATUS_COLOR_MAP } from '@/lib/constants/status'

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

  // Handle status change
  const handleStatusChange = useCallback((newStatus: string) => {
    setStatus(newStatus)
    setFilter('/pull-requests', newStatus)
    setPage(1)
    setStorePage('/pull-requests', 1)
  }, [setFilter, setStorePage])

  // Handle page change
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
    setStorePage('/pull-requests', newPage)
  }, [setStorePage])

  const statusParam = status === 'all' ? '' : `&status=${status}`
  const { data, error, isLoading, mutate } = useAPI<PRResponse>(
    `/api/pull-requests?page=${page}&pageSize=10${statusParam}`
  )

  const showSkeleton = isLoading && !data

  const getActionText = (action: string) => {
    const map: Record<string, string> = {
      Create: '新增',
      Change: '修改',
      Delete: '删除'
    }
    return map[action] || action
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
          <Button
            isIconOnly
            variant="flat"
            size="sm"
            onPress={() => mutate()}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <Tabs
          selectedKey={status}
          onSelectionChange={(key) => handleStatusChange(key as string)}
          className="mb-6"
        >
          <Tab key="all" title="全部" />
          <Tab key="Pending" title="待审核" />
          <Tab key="Approved" title="已通过" />
          <Tab key="Rejected" title="已拒绝" />
        </Tabs>

        <div className="grid gap-4 transition-opacity duration-300" style={{ opacity: showSkeleton ? 0.6 : 1 }}>
          {error ? (
            <Card>
              <CardBody className="text-center py-12">
                <p className="text-danger mb-4">加载失败</p>
                <p className="text-default-500">{error.message}</p>
              </CardBody>
            </Card>
          ) : showSkeleton ? (
            Array.from({ length: 5 }).map((_, i) => (
              <PullRequestCardSkeleton key={i} />
            ))
          ) : (
            <>
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
                        <Chip color="warning" size="sm" variant="flat" startContent={<AlertTriangle className="w-3 h-3" />}>
                          冲突
                        </Chip>
                      )}
                      <Chip
                        color={STATUS_COLOR_MAP[pr.status] || 'default'}
                        size="sm"
                        variant="flat"
                      >
                        {PR_STATUS_MAP[pr.status] || pr.status}
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
                        <span className="flex items-center gap-1">
                          <LinkIcon className="w-3 h-3" /> {pr._count.dependencies + pr._count.dependedBy} 个依赖
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
            </>
          )}
        </div>

        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="mt-6 flex justify-center gap-2">
            <Button
              isDisabled={data.pagination.page === 1}
              onPress={() => handlePageChange(data.pagination.page - 1)}
            >
              上一页
            </Button>
            <span className="flex items-center px-4">
              {data.pagination.page} / {data.pagination.totalPages}
            </span>
            <Button
              isDisabled={data.pagination.page === data.pagination.totalPages}
              onPress={() => handlePageChange(data.pagination.page + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
