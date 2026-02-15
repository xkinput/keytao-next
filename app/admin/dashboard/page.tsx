'use client'

import { Card, CardBody, CardHeader, Spinner, Chip } from '@heroui/react'
import { useAPI } from '@/lib/hooks/useSWR'
import { getPhraseTypeLabel, type PhraseType } from '@/lib/constants/phraseTypes'
import { BATCH_STATUS_MAP, STATUS_COLOR_MAP } from '@/lib/constants/status'

interface Stats {
  totalPhrases: number
  totalIssues: number
  totalUsers: number
  totalPullRequests: number
  totalBatches: number
  pendingSyncBatches: number
  syncedBatches: number
  phrasesByType: Record<string, number>
  batchesByStatus: Record<string, number>
  recentStats: {
    submittedBatches: number
    approvedBatches: number
  }
}

export default function DashboardPage() {
  const { data: stats, isLoading } = useAPI<Stats>('/api/admin/stats')

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" label="加载中..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-8">数据概览</h1>

        {/* 基础统计 */}
        <h2 className="text-xl font-semibold mb-4">总览</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">词条总数</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-primary">
                {stats?.totalPhrases || 0}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">批次总数</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-secondary">
                {stats?.totalBatches || 0}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">讨论总数</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-success">
                {stats?.totalIssues || 0}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">用户总数</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-warning">
                {stats?.totalUsers || 0}
              </p>
            </CardBody>
          </Card>
        </div>

        {/* 各类型词条统计 */}
        <h2 className="text-xl font-semibold mb-4">词条类型分布</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          {stats?.phrasesByType && Object.entries(stats.phrasesByType)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <Card key={type}>
                <CardBody className="py-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-default-600">{getPhraseTypeLabel(type as PhraseType)}</span>
                    <span className="text-2xl font-bold">{count}</span>
                  </div>
                </CardBody>
              </Card>
            ))}
        </div>

        {/* 批次状态统计 */}
        <h2 className="text-xl font-semibold mb-4">批次状态分布</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          {stats?.batchesByStatus && (() => {
            // 定义状态显示顺序
            const statusOrder = ['Draft', 'Submitted', 'Approved', 'Rejected', 'Published']
            // 合并数据，确保关键状态始终显示
            const statusData = statusOrder.map(status => ({
              status,
              count: stats.batchesByStatus[status] || 0
            }))

            return statusData.map(({ status, count }) => (
              <Card key={status}>
                <CardBody className="py-4">
                  <div className="flex flex-col gap-2">
                    <Chip
                      color={STATUS_COLOR_MAP[status] || 'default'}
                      variant="flat"
                      size="sm"
                    >
                      {BATCH_STATUS_MAP[status] || status}
                    </Chip>
                    <span className="text-3xl font-bold">{count}</span>
                  </div>
                </CardBody>
              </Card>
            ))
          })()}
        </div>

        {/* 近期活动统计 */}
        <h2 className="text-xl font-semibold mb-4">近7天活动</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">提交批次</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-primary">
                {stats?.recentStats.submittedBatches || 0}
              </p>
              <p className="text-sm text-default-500 mt-2">近7天内提交审核的批次</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">通过批次</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-success">
                {stats?.recentStats.approvedBatches || 0}
              </p>
              <p className="text-sm text-default-500 mt-2">近7天内通过审核的批次</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">待同步批次</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-warning">
                {stats?.pendingSyncBatches || 0}
              </p>
              <p className="text-sm text-default-500 mt-2">已通过但未同步到GitHub</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">已同步批次</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-secondary">
                {stats?.syncedBatches || 0}
              </p>
              <p className="text-sm text-default-500 mt-2">已成功同步到GitHub的批次</p>
            </CardBody>
          </Card>
        </div>
      </main>
    </div>
  )
}
