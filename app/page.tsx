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
  Tab,
  Input,
  Switch
} from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI } from '@/lib/hooks/useSWR'
import { usePageFilterStore } from '@/lib/store/pageFilter'
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
    conflictInfo?: {
      hasConflict: boolean
      impact?: string
      suggestions?: Array<{
        action: string
        word?: string
        reason: string
      }>
    }
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
  const { getFilter, setFilter, getPage, setPage: setStorePage } = usePageFilterStore()
  const [status, setStatus] = useState<string>(() => getFilter('/', 'all'))
  const [page, setPage] = useState(() => getPage('/', 1))
  const [onlyMine, setOnlyMine] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // Sync status changes to store (resets page to 1)
  useEffect(() => {
    setFilter('/', status)
  }, [status, setFilter])

  // Reset page to 1 when status, onlyMine or search changes
  useEffect(() => {
    if (page !== 1) {
      setPage(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, onlyMine, search])

  // Sync page changes to store
  useEffect(() => {
    setStorePage('/', page)
  }, [page, setStorePage])

  const { data, isLoading } = useAPI<BatchesResponse>(
    `/api/batches?page=${page}&pageSize=10${status === 'all' ? '' : `&status=${status}`}${onlyMine ? '&onlyMine=true' : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { withAuth: onlyMine, keepPreviousData: true }
  )

  const handleSearch = () => {
    setSearch(searchInput)
  }

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const filteredBatches = data?.batches || []

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

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 dark:bg-none dark:bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">改词</h2>
              <p className="text-default-500">
                {search ? (
                  <>搜索 &ldquo;{search}&rdquo; 的结果：{data?.pagination?.total || 0} 个</>
                ) : onlyMine ? (
                  <>我的批次：{data?.pagination?.total || 0} 个</>
                ) : (
                  <>共 {data?.pagination?.total || 0} 个</>
                )}
              </p>
              {!isAuthenticated() && (
                <p className="text-sm text-default-500">当前为访客，仅可查看，登录后可创建与编辑。</p>
              )}
            </div>
            <Button
              as={Link}
              href="/batch/new"
              color="primary"
            >
              新建
            </Button>
          </div>

          {/* Filters and Search */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
            <Tabs
              selectedKey={status}
              onSelectionChange={(key) => setStatus(key as string)}
              color="primary"
              variant="underlined"
              classNames={{
                tabList: "gap-4 w-full relative rounded-none p-0 border-b border-divider",
                cursor: "w-full bg-primary",
                tab: "max-w-fit px-0 h-12",
                tabContent: "group-data-[selected=true]:text-primary"
              }}
            >
              <Tab key="all" title="全部" />
              <Tab key="Draft" title="草稿" />
              <Tab key="Submitted" title="待审核" />
              <Tab key="Approved" title="已通过" />
              <Tab key="Published" title="已发布" />
            </Tabs>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
              <div className="flex gap-2 w-full sm:w-auto">
                <Input
                  placeholder="搜索编码或词组(回车)..."
                  value={searchInput}
                  onValueChange={setSearchInput}
                  onKeyDown={handleSearchKeyPress}
                  size="sm"
                  className="w-full sm:w-64"
                  isClearable
                  onClear={() => {
                    setSearch('')
                    setSearchInput('')
                  }}
                />
              </div>

              {isAuthenticated() && (
                <div className="flex items-center gap-2 sm:pl-2 sm:border-l sm:border-default-200">
                  <Switch
                    isSelected={onlyMine}
                    onValueChange={setOnlyMine}
                    size="sm"
                  >
                    <span className="text-small text-default-600">仅我的</span>
                  </Switch>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4">
            {filteredBatches.map((batch) => (
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
                    {batch.pullRequests.some(pr => pr.conflictInfo?.hasConflict ?? pr.hasConflict) && (
                      <Chip color="warning" size="sm" variant="flat">
                        ⚠️ 有冲突
                      </Chip>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}

            {filteredBatches.length === 0 && (
              <Card>
                <CardBody className="text-center py-12">
                  <p className="text-default-500">
                    {search ? '未找到匹配的批次' : onlyMine ? '你还没有创建任何批次' : '暂无批次'}
                  </p>
                </CardBody>
              </Card>
            )}
          </div>

          {data?.pagination && data.pagination.totalPages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              <Button
                isDisabled={data.pagination.page === 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="flex items-center px-4">
                {data.pagination.page} / {data.pagination.totalPages}
              </span>
              <Button
                isDisabled={data.pagination.page === data.pagination.totalPages}
                onPress={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
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
