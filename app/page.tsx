'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  Button,
  Tabs,
  Tab,
  Input
} from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { usePageFilterStore } from '@/lib/store/pageFilter'
import BatchCard from '@/app/components/BatchCard'
import BatchCardSkeleton from '@/app/components/BatchCardSkeleton'

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
    action: 'Create' | 'Change' | 'Delete'
    code: string | null
    word: string | null
    oldWord?: string | null
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
  const router = useRouter()
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const isAuthenticatedValue = isAuthenticated()
  const { getFilter, setFilter, getPage, setPage: setStorePage } = usePageFilterStore()
  const [status, setStatus] = useState<string>(() => getFilter('/', 'all'))
  const [page, setPage] = useState(() => getPage('/', 1))
  const [onlyMine, setOnlyMine] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Handle status change
  const handleStatusChange = useCallback((newStatus: string) => {
    setStatus(newStatus)
    setFilter('/', newStatus)
    setPage(1)
    setStorePage('/', 1)
  }, [setFilter, setStorePage])

  // Handle onlyMine toggle
  const handleOnlyMineChange = useCallback((value: boolean) => {
    setOnlyMine(value)
    setPage(1)
    setStorePage('/', 1)
  }, [setStorePage])

  // Handle page change
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
    setStorePage('/', newPage)
  }, [setStorePage])

  const { data, isLoading, mutate } = useAPI<BatchesResponse>(
    `/api/batches?page=${page}&pageSize=10${status === 'all' ? '' : `&status=${status}`}${onlyMine ? '&onlyMine=true' : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { withAuth: onlyMine, keepPreviousData: true }
  )

  const handleSearch = useCallback(() => {
    setSearch(searchInput)
    setPage(1)
    setStorePage('/', 1)
  }, [searchInput, setStorePage])

  const handleClearSearch = useCallback(() => {
    setSearch('')
    setSearchInput('')
    setPage(1)
    setStorePage('/', 1)
  }, [setStorePage])

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleCreateBatch = async () => {
    if (!isAuthenticatedValue) {
      router.push('/login')
      return
    }

    setIsCreating(true)
    try {
      const now = new Date()
      const defaultName = `修改批次 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      const result = await apiRequest('/api/batches', {
        method: 'POST',
        body: { description: defaultName },
        withAuth: true
      }) as { batch: { id: string } }

      router.push(`/batch/${result.batch.id}`)
    } catch (error) {
      alert(error instanceof Error ? error.message : '创建失败')
      setIsCreating(false)
    }
  }

  const filteredBatches = data?.batches || []
  const showSkeleton = isLoading && !data

  return (
    <div className="min-h-screen">
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
          </div>
          <div className="flex items-center gap-2">
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              onPress={() => mutate()}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              color="primary"
              onPress={handleCreateBatch}
              isLoading={isCreating}
            >
              新建
            </Button>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
          <Tabs
            selectedKey={status}
            onSelectionChange={(key) => handleStatusChange(key as string)}
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
                onClear={handleClearSearch}
              />
            </div>

            {isAuthenticatedValue && (
              <div className="flex items-center sm:pl-2 sm:border-l sm:border-default-200">
                <Tabs
                  selectedKey={onlyMine ? 'mine' : 'all'}
                  onSelectionChange={(key) => handleOnlyMineChange(key === 'mine')}
                  size="sm"
                  radius="full"
                  color="primary"
                >
                  <Tab key="all" title="全部" />
                  <Tab key="mine" title="我的" />
                </Tabs>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 transition-opacity duration-300" style={{ opacity: showSkeleton ? 0.6 : 1 }}>
          {showSkeleton ? (
            // Show skeleton loading
            Array.from({ length: 3 }).map((_, i) => (
              <BatchCardSkeleton key={i} />
            ))
          ) : (
            <>
              {filteredBatches.map((batch) => (
                <BatchCard key={batch.id} batch={batch} refresh={mutate} />
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
            </>
          )}
        </div>

        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="mt-6 flex justify-center gap-2">
            <Button
              isDisabled={data.pagination.page === 1}
              onPress={() => handlePageChange(Math.max(1, page - 1))}
            >
              上一页
            </Button>
            <span className="flex items-center px-4">
              {data.pagination.page} / {data.pagination.totalPages}
            </span>
            <Button
              isDisabled={data.pagination.page === data.pagination.totalPages}
              onPress={() => handlePageChange(Math.min(data.pagination.totalPages, page + 1))}
            >
              下一页
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
