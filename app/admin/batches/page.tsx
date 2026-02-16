'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  RadioGroup,
  Radio
} from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'
import { usePageFilterStore } from '@/lib/store/pageFilter'
import AdminBatchCardSkeleton from '@/app/components/AdminBatchCardSkeleton'
import { BATCH_STATUS_MAP, STATUS_COLOR_MAP } from '@/lib/constants/status'

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
  _count: {
    pullRequests: number
  }
}

export default function AdminBatchesPage() {
  const router = useRouter()
  const { getFilter, setFilter } = usePageFilterStore()
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    getFilter('/admin/batches', 'Submitted')
  )

  // Handle status change
  const handleStatusChange = useCallback((newStatus: string) => {
    setStatusFilter(newStatus)
    setFilter('/admin/batches', newStatus)
  }, [setFilter])

  const { data, error, isLoading, mutate } = useAPI<{ batches: Batch[] }>(
    `/api/admin/batches?status=${statusFilter}`
  )

  const showSkeleton = isLoading && !data
  const batches = data?.batches || []

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-3xl font-bold">批次审核</h1>
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              onPress={() => mutate()}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          <RadioGroup
            label="状态筛选"
            value={statusFilter}
            onValueChange={handleStatusChange}
            orientation="horizontal"
            className="mb-4"
          >
            <Radio value="Submitted">待审核</Radio>
            <Radio value="Approved">已批准</Radio>
            <Radio value="Rejected">已拒绝</Radio>
            <Radio value="Published">已发布</Radio>
          </RadioGroup>
        </div>

        <div className="space-y-4 transition-opacity duration-300" style={{ opacity: showSkeleton ? 0.6 : 1 }}>
          {error ? (
            <Card>
              <CardBody className="text-center py-12">
                <p className="text-danger mb-4">加载失败</p>
                <p className="text-default-500">{error.message}</p>
              </CardBody>
            </Card>
          ) : showSkeleton ? (
            Array.from({ length: 3 }).map((_, i) => (
              <AdminBatchCardSkeleton key={i} />
            ))
          ) : batches.length === 0 ? (
            <Card>
              <CardBody className="text-center py-12">
                <p className="text-default-500">暂无{BATCH_STATUS_MAP[statusFilter] || statusFilter}的批次</p>
              </CardBody>
            </Card>
          ) : (
            batches.map((batch) => (
              <Card key={batch.id} isPressable onPress={() => router.push(`/admin/batches/${batch.id}`)}>
                <CardHeader className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold">
                        {batch.description || '未命名批次'}
                      </h3>
                      <Chip
                        color={STATUS_COLOR_MAP[batch.status] || 'default'}
                        size="sm"
                        variant="flat"
                      >
                        {BATCH_STATUS_MAP[batch.status] || batch.status}
                      </Chip>
                    </div>
                    <div className="flex items-center gap-4 text-small text-default-500">
                      <span>
                        创建者: {batch.creator.nickname || batch.creator.name}
                      </span>
                      <span>
                        修改数: {batch._count.pullRequests}
                      </span>
                      <span>
                        创建时间: {new Date(batch.createAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  )
}
