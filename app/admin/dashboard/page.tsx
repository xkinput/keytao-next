'use client'

import { Card, CardBody, CardHeader, Spinner } from '@heroui/react'
import { useAPI } from '@/lib/hooks/useSWR'

interface Stats {
  totalPhrases: number
  totalIssues: number
  totalUsers: number
  totalPullRequests: number
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
              <h3 className="text-lg font-semibold">Issues 总数</h3>
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

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">Pull Requests</h3>
            </CardHeader>
            <CardBody>
              <p className="text-4xl font-bold text-secondary">
                {stats?.totalPullRequests || 0}
              </p>
            </CardBody>
          </Card>
        </div>
      </main>
    </div>
  )
}
