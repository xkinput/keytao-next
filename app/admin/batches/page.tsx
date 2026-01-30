'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip,
  Select,
  SelectItem
} from '@heroui/react'
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
  _count: {
    pullRequests: number
  }
}

export default function AdminBatchesPage() {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<string>('Submitted')

  const { data, error, isLoading } = useAPI<{ batches: Batch[] }>(
    `/api/admin/batches?status=${statusFilter}`
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
      Submitted: '待审核',
      Approved: '已批准',
      Rejected: '已拒绝',
      Published: '已发布'
    }
    return map[status] || status
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

  if (error) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center p-8">
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

  const batches = data?.batches || []

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 dark:bg-none dark:bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-4">批次审核</h1>

            <div className="flex items-center gap-4 mb-4">
              <Select
                label="状态筛选"
                selectedKeys={[statusFilter]}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="max-w-xs"
              >
                <SelectItem key="Submitted">待审核</SelectItem>
                <SelectItem key="Approved">已批准</SelectItem>
                <SelectItem key="Rejected">已拒绝</SelectItem>
                <SelectItem key="Published">已发布</SelectItem>
              </Select>
            </div>
          </div>

          {batches.length === 0 ? (
            <Card>
              <CardBody className="text-center py-12">
                <p className="text-default-500">暂无{getStatusText(statusFilter)}的批次</p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-4">
              {batches.map((batch) => (
                <Card key={batch.id} isPressable onPress={() => router.push(`/admin/batches/${batch.id}`)}>
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
                    <Button
                      size="sm"
                      variant="flat"
                      color="primary"
                    >
                      查看详情
                    </Button>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
