'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  Button,
  Tabs,
  Tab,
  Input,
  Pagination
} from '@/lib/heroui-compat'
import { FilePlus2, RefreshCw, Search } from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { useClientReady } from '@/lib/hooks/useClientReady'
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
  const isClientReady = useClientReady()
  const isAuthenticatedValue = isClientReady && isAuthenticated()
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
      <main className="app-container py-8 md:py-10">
        <section className="mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-default-500">词库协作</p>
            <h1 className="mt-2 text-[clamp(2.15rem,4vw,4.25rem)] font-semibold leading-[0.96] tracking-[-0.055em] text-foreground">
              改词批次
            </h1>
            <p className="mt-3 text-base text-default-500">
              {search ? (
                <>搜索 &ldquo;{search}&rdquo; 的结果：{data?.pagination?.total || 0} 个</>
              ) : onlyMine ? (
                <>我的批次：{data?.pagination?.total || 0} 个</>
              ) : (
                <>共 {data?.pagination?.total || 0} 个</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 md:pb-1">
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              onPress={() => mutate()}
              aria-label="刷新批次"
              className="h-10 w-10"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              color="primary"
              onPress={handleCreateBatch}
              isLoading={isCreating}
              startContent={<FilePlus2 className="h-4 w-4" />}
              className="h-10 px-4"
            >
              新建批次
            </Button>
          </div>
        </section>

        {/* Filters and Search */}
        <div className="workbench-toolbar mb-5 flex flex-col gap-3 rounded-xl p-2.5 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            selectedKey={status}
            onSelectionChange={(key) => handleStatusChange(key as string)}
            color="primary"
            variant="underlined"
            className="w-full overflow-x-auto lg:w-auto"
            classNames={{
              tabList: "min-w-max gap-0.5 relative rounded-lg p-1 bg-content2/70",
              cursor: "hidden",
              tab: "max-w-fit h-9 rounded-md px-3 data-[selected=true]:bg-content1 data-[selected=true]:shadow-[0_1px_1px_hsl(var(--shadow-color)/0.08)]",
              tabContent: "text-default-500 group-data-[selected=true]:text-foreground"
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
                className="w-full sm:w-80"
                startContent={<Search className="h-4 w-4 text-default-400" />}
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

        <div className="grid gap-3 transition-opacity duration-300" style={{ opacity: showSkeleton ? 0.6 : 1 }}>
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
                <Card className="empty-state">
                  <CardBody className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 text-primary">
                      <FilePlus2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {search ? '没有匹配的批次' : onlyMine ? '你还没有创建批次' : '暂无批次'}
                      </p>
                      <p className="mt-1 text-sm text-default-500">
                        {search ? '换一个词或编码再试试。' : '登录后可以创建批次并提交词条修改。'}
                      </p>
                    </div>
                    {!search && (
                      <Button color="primary" size="sm" onPress={handleCreateBatch} startContent={<FilePlus2 className="h-4 w-4" />}>
                        新建批次
                      </Button>
                    )}
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </div>

        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="mt-6 flex justify-center">
            <Pagination
              total={data.pagination.totalPages}
              page={data.pagination.page}
              onChange={handlePageChange}
            />
          </div>
        )}
      </main>
    </div>
  )
}
