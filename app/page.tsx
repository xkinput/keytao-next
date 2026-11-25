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
import { FilePlus2, RefreshCw, Search, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/lib/store/auth'
import { useUIStore } from '@/lib/store/ui'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { useClientReady } from '@/lib/hooks/useClientReady'
import { usePageFilterStore } from '@/lib/store/pageFilter'
import BatchCard from '@/app/components/BatchCard'
import BatchCardSkeleton from '@/app/components/BatchCardSkeleton'

interface Batch {
  id: string
  description: string
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected'
  contentVersion: number
  rejectionRead?: boolean
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
  lastSyncedAt: string | null
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

interface DraftTodosResponse {
  unsubmitted: number
  rejected: number
  emptyDrafts: number
}

const DRAFT_TODOS_URL = '/api/batches/draft-todos'

function TodoTabTitle({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex items-start gap-1">
      {label}
      {count > 0 && (
        <span className="relative -mt-1 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-4 text-white tabular-nums max-sm:text-xs">
          <span className="sr-only">待办 </span>{count}
        </span>
      )}
    </span>
  )
}

function formatSyncTime(value: string) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function BatchesPage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const userId = useAuthStore(state => state.user?.id)
  const openConfirm = useUIStore(state => state.openConfirm)
  const isClientReady = useClientReady()
  const isAuthenticatedValue = isClientReady && isAuthenticated()
  const { getFilter, setFilter, getPage, setPage: setStorePage } = usePageFilterStore()
  const [status, setStatus] = useState<string>(() => getFilter('/', 'all'))
  const [page, setPage] = useState(() => getPage('/', 1))
  const [onlyMine, setOnlyMine] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const myBatches = onlyMine && isAuthenticatedValue
  const myDrafts = myBatches && status === 'Draft'
  const batchStatus = myDrafts ? 'DraftTodos' : status

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
    `/api/batches?page=${page}&pageSize=10${batchStatus === 'all' ? '' : `&status=${batchStatus}`}${myBatches ? '&onlyMine=true' : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { withAuth: myBatches, keepPreviousData: false }
  )
  const { data: draftTodos, mutate: refreshDraftTodos } = useAPI<DraftTodosResponse>(
    isAuthenticatedValue ? DRAFT_TODOS_URL : null,
    { keepPreviousData: false },
  )
  const todoCount = (draftTodos?.unsubmitted ?? 0) + (draftTodos?.rejected ?? 0)

  const refreshBatches = useCallback(async () => {
    await Promise.allSettled([mutate(), refreshDraftTodos()])
  }, [mutate, refreshDraftTodos])

  const handleCleanEmptyDrafts = () => {
    if (!myDrafts || userId === undefined || !draftTodos?.emptyDrafts) return

    openConfirm('确定删除本人所有没有词条的草稿吗？', async () => {
      if (useAuthStore.getState().user?.id !== userId) throw new Error('登录账号已变化，请重新打开草稿列表')
      const { deleted } = await apiRequest<{ deleted: number }>(DRAFT_TODOS_URL, { method: 'DELETE' })
      handlePageChange(1)
      await refreshBatches()
      toast.success(deleted > 0 ? `已清理 ${deleted} 个空草稿` : '当前没有空草稿')
    }, '清理空草稿', '清理')
  }

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
        <section className="mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between" data-motion="fade-up">
          <div className="max-w-3xl">
            <p className="page-kicker">词库协作</p>
            <h1 className="page-title">
              改词批次
            </h1>
            <p className="mt-3 text-base text-default-500">
              {search ? (
                <>搜索 &ldquo;{search}&rdquo; 的结果：{data?.pagination?.total || 0} 个</>
              ) : myBatches ? (
                <>我的批次：{data?.pagination?.total || 0} 个</>
              ) : (
                <>共 {data?.pagination?.total || 0} 个</>
              )}
              {data?.lastSyncedAt && ` · GitHub 同步于 ${formatSyncTime(data.lastSyncedAt)}`}
            </p>
          </div>
          <div className="flex items-center gap-2 md:pb-1">
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              onPress={refreshBatches}
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
        <div className="workbench-toolbar mb-5 flex flex-col gap-3 rounded-xl p-2.5 lg:flex-row lg:items-center lg:justify-between" data-motion="fade-up">
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
            <Tab key="Draft" title={<TodoTabTitle label="草稿" count={myBatches ? todoCount : 0} />} />
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
                  selectedKey={myBatches ? 'mine' : 'all'}
                  onSelectionChange={(key) => handleOnlyMineChange(key === 'mine')}
                  size="sm"
                  radius="full"
                  color="primary"
                >
                  <Tab key="all" title="全部" />
                  <Tab key="mine" title={<TodoTabTitle label="我的" count={todoCount} />} />
                </Tabs>
              </div>
            )}
          </div>
        </div>

        {myDrafts && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-sm text-default-600">
              <span className="font-medium text-foreground">待办</span>
              {draftTodos ? ` · 待提交 ${draftTodos.unsubmitted} · 拒绝未读 ${draftTodos.rejected}` : ' · 包括待提交草稿和未读的拒绝结果'}
            </p>
            <Button
              size="sm"
              variant="light"
              isDisabled={!draftTodos?.emptyDrafts}
              startContent={<Trash2 aria-hidden="true" className="size-4" />}
              onPress={handleCleanEmptyDrafts}
            >
              一键清理空草稿
            </Button>
          </div>
        )}

        <div className="grid gap-3 transition-opacity duration-300" style={{ opacity: showSkeleton ? 0.6 : 1 }}>
          {showSkeleton ? (
            // Show skeleton loading
            Array.from({ length: 3 }).map((_, i) => (
              <BatchCardSkeleton key={i} />
            ))
          ) : (
            <>
              {filteredBatches.map((batch) => (
                <BatchCard key={batch.id} batch={batch} refresh={refreshBatches} />
              ))}

              {filteredBatches.length === 0 && (
                <Card className="empty-state">
                  <CardBody className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 text-primary">
                      <FilePlus2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {search ? '没有匹配的批次' : myDrafts ? '暂无草稿待办' : myBatches ? '你还没有创建批次' : '暂无批次'}
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
