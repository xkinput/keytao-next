'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip
} from '@heroui/react'
import { useAPI } from '@/lib/hooks/useSWR'
import Link from 'next/link'

interface PRDetail {
  id: number
  word: string | null
  code: string | null
  action: 'Create' | 'Change' | 'Delete'
  status: 'Pending' | 'Approved' | 'Rejected'
  hasConflict: boolean
  conflictReason: string | null
  conflictInfo?: {
    hasConflict: boolean
    impact?: string
    suggestions?: Array<{
      action: string
      word?: string
      reason: string
    }>
  }
  remark: string | null
  weight: number | null
  createAt: string
  updateAt: string
  phrase?: {
    id: number
    word: string
    code: string
    weight: number
  }
  user: {
    id: number
    name: string
    nickname: string | null
  }
  batch?: {
    id: string
    description: string
    status: string
    sourceIssue?: {
      id: number
      title: string
    }
  }
  conflicts: Array<{
    code: string
    currentWord: string | null
    proposedWord: string
    resolvedAt: string | null
  }>
  dependencies: Array<{
    dependsOn: {
      id: number
      word: string | null
      code: string | null
      action: string
    }
    reason: string
  }>
  dependedBy: Array<{
    dependent: {
      id: number
      word: string | null
      code: string | null
      action: string
    }
    reason: string
  }>
  likedBy: Array<{
    id: number
    name: string
    nickname: string | null
  }>
  dislikedBy: Array<{
    id: number
    name: string
    nickname: string | null
  }>
}

export default function PRDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const { data, error, isLoading } = useAPI<{ pullRequest: PRDetail }>(
    `/api/pull-requests/${resolvedParams.id}`
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

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <Card className="max-w-md">
          <CardBody className="text-center">
            <p className="text-danger mb-4">加载失败</p>
            <p className="text-default-500">{error?.message || 'PR 不存在'}</p>
            <Button
              className="mt-4"
              onPress={() => router.push('/pull-requests')}
            >
              返回列表
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const pr = data.pullRequest

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Button
          variant="light"
          onPress={() => router.push('/pull-requests')}
          className="mb-6"
        >
          ← 返回列表
        </Button>

        {/* Main Info */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex justify-between items-start w-full">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Chip size="sm" variant="flat">
                    {getActionText(pr.action)}
                  </Chip>
                  <h2 className="text-2xl font-bold">
                    {pr.word || pr.phrase?.word}
                  </h2>
                  <span className="text-default-500">→</span>
                  <code className="text-xl text-primary">
                    {pr.code || pr.phrase?.code}
                  </code>
                </div>
                <p className="text-small text-default-500">
                  由 {pr.user.nickname || pr.user.name} 创建于{' '}
                  {new Date(pr.createAt).toLocaleString('zh-CN')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(pr.conflictInfo?.hasConflict ?? pr.hasConflict) && (
                  <Chip color="warning" size="sm" variant="flat">
                    ⚠️ 冲突
                  </Chip>
                )}
                <Chip color={getStatusColor(pr.status)} variant="flat">
                  {pr.status}
                </Chip>
              </div>
            </div>
          </CardHeader>
          {(pr.remark || pr.weight !== null) && (
            <CardBody>
              {pr.weight !== null && (
                <p className="text-small mb-2">
                  <span className="font-medium">权重:</span> {pr.weight}
                </p>
              )}
              {pr.remark && (
                <div>
                  <p className="text-small font-medium mb-1">备注:</p>
                  <p className="text-small text-default-500 whitespace-pre-wrap">
                    {pr.remark}
                  </p>
                </div>
              )}
            </CardBody>
          )}
        </Card>

        {/* Batch Info */}
        {pr.batch && (
          <Card className="mb-6">
            <CardHeader className="font-semibold">所属批次</CardHeader>
            <CardBody>
              <Link
                href={`/batch/${pr.batch.id}`}
                className="text-primary hover:underline"
              >
                {pr.batch.description}
              </Link>
              <p className="text-small text-default-500 mt-1">
                状态: {pr.batch.status}
              </p>
              {pr.batch.sourceIssue && (
                <p className="text-small text-default-500">
                  关联讨论: #{pr.batch.sourceIssue.id} {pr.batch.sourceIssue.title}
                </p>
              )}
            </CardBody>
          </Card>
        )}

        {/* Conflicts */}
        {pr.conflicts.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="font-semibold">⚠️ 冲突详情</CardHeader>
            <CardBody>
              {(pr.conflictInfo?.impact || pr.conflictReason) && (
                <p className="text-small mb-4 p-3 bg-warning-50 dark:bg-warning-100/10 rounded-lg">
                  {pr.conflictInfo?.impact || pr.conflictReason}
                </p>
              )}
              <div className="space-y-2">
                {pr.conflicts.map((conflict, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-default-100 rounded-lg text-small"
                  >
                    <p>
                      编码 <code className="text-primary">{conflict.code}</code>
                      被 <strong>{conflict.currentWord}</strong> 占用
                    </p>
                    <p className="text-default-500 mt-1">
                      提议词: <strong>{conflict.proposedWord}</strong>
                    </p>
                    {conflict.resolvedAt && (
                      <Chip color="success" size="sm" className="mt-2">
                        已解决
                      </Chip>
                    )}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Dependencies */}
        {(pr.dependencies.length > 0 || pr.dependedBy.length > 0) && (
          <Card className="mb-6">
            <CardHeader className="font-semibold">🔗 依赖关系</CardHeader>
            <CardBody className="space-y-4">
              {pr.dependencies.length > 0 && (
                <div>
                  <p className="font-medium text-small mb-2">依赖于:</p>
                  <div className="space-y-2 ml-4">
                    {pr.dependencies.map((dep, idx) => (
                      <div key={idx} className="text-small">
                        <Link
                          href={`/pull-requests/${dep.dependsOn.id}`}
                          className="text-primary hover:underline"
                        >
                          PR#{dep.dependsOn.id}: {dep.dependsOn.word} → {dep.dependsOn.code}
                        </Link>
                        <p className="text-default-500 text-tiny">{dep.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pr.dependedBy.length > 0 && (
                <div>
                  <p className="font-medium text-small mb-2">被依赖:</p>
                  <div className="space-y-2 ml-4">
                    {pr.dependedBy.map((dep, idx) => (
                      <div key={idx} className="text-small">
                        <Link
                          href={`/pull-requests/${dep.dependent.id}`}
                          className="text-primary hover:underline"
                        >
                          PR#{dep.dependent.id}: {dep.dependent.word} → {dep.dependent.code}
                        </Link>
                        <p className="text-default-500 text-tiny">{dep.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Original Phrase */}
        {pr.phrase && (
          <Card>
            <CardHeader className="font-semibold">原词条信息</CardHeader>
            <CardBody>
              <div className="grid grid-cols-3 gap-4 text-small">
                <div>
                  <p className="text-default-500">词</p>
                  <p className="font-medium">{pr.phrase.word}</p>
                </div>
                <div>
                  <p className="text-default-500">编码</p>
                  <p className="font-medium">
                    <code className="text-primary">{pr.phrase.code}</code>
                  </p>
                </div>
                <div>
                  <p className="text-default-500">权重</p>
                  <p className="font-medium">{pr.phrase.weight}</p>
                </div>
              </div>
            </CardBody>
          </Card>
        )}
      </main>
    </div>
  )
}
