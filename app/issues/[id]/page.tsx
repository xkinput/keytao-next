'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip,
  Textarea,
  Avatar,
  Divider
} from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import Navbar from '@/app/components/Navbar'

interface Comment {
  id: number
  content: string
  createAt: string
  author: {
    id: number
    name: string
    nickname: string | null
  }
}

interface Batch {
  id: string
  description: string | null
  status: string
  createAt: string
}

interface Issue {
  id: number
  title: string
  content: string
  status: boolean
  createAt: string
  updateAt: string
  author: {
    id: number
    name: string
    nickname: string | null
  }
  comments: Comment[]
  batches: Batch[]
}

interface IssueResponse {
  issue: Issue
}

const BatchCard = ({ batch }: { batch: Batch }) => {
  const router = useRouter()

  const statusColors: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
    Draft: 'default',
    Submitted: 'primary',
    Approved: 'success',
    Rejected: 'danger',
    Published: 'warning'
  }

  const statusTexts: Record<string, string> = {
    Draft: '草稿',
    Submitted: '已提交',
    Approved: '已通过',
    Rejected: '已拒绝',
    Published: '已发布'
  }

  return (
    <Card
      isPressable
      onPress={() => router.push(`/batch/${batch.id}`)}
      className="my-2"
    >
      <CardBody className="flex flex-row items-center justify-between">
        <div className="flex-1">
          <p className="font-semibold">批次 #{batch.id.slice(0, 8)}</p>
          <p className="text-small text-default-500">
            {batch.description || '无描述'}
          </p>
          <p className="text-tiny text-default-400">
            创建于 {new Date(batch.createAt).toLocaleString('zh-CN')}
          </p>
        </div>
        <Chip color={statusColors[batch.status] || 'default'} variant="flat">
          {statusTexts[batch.status] || batch.status}
        </Chip>
      </CardBody>
    </Card>
  )
}

// Parse content and convert @batch-id references to batch cards
const renderContent = (content: string, batches: Batch[]) => {
  const parts: (string | React.ReactNode)[] = []
  const batchRegex = /@batch-([a-f0-9-]+)/gi

  let lastIndex = 0
  let match

  while ((match = batchRegex.exec(content)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }

    const batchId = match[1]
    const batch = batches.find(b => b.id.startsWith(batchId))

    if (batch) {
      parts.push(<BatchCard key={`batch-${match.index}`} batch={batch} />)
    } else {
      // If batch not found, keep the original text
      parts.push(match[0])
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [content]
}

export default function IssueDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { isAuthenticated, user } = useAuthStore()
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data, error, isLoading, mutate } = useAPI<IssueResponse>(
    `/api/issues/${params.id}`
  )

  const handleToggleStatus = async () => {
    if (!data?.issue) return

    try {
      await apiRequest(`/api/issues/${params.id}`, {
        method: 'PATCH',
        body: { status: !data.issue.status }
      })
      mutate()
    } catch (error: any) {
      console.error('Toggle status error:', error)
      alert(error.message || '更新状态失败')
    }
  }

  const handleSubmitComment = async () => {
    if (!comment.trim()) return

    setIsSubmitting(true)
    try {
      await apiRequest(`/api/issues/${params.id}/comments`, {
        method: 'POST',
        body: { content: comment }
      })
      setComment('')
      mutate()
    } catch (error: any) {
      console.error('Submit comment error:', error)
      alert(error.message || '发表评论失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size="lg" label="正在加载..." />
      </div>
    )
  }

  if (error || !data?.issue) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <Card className="max-w-md">
            <CardBody className="text-center">
              <p className="text-danger mb-4">加载失败</p>
              <p className="text-default-500 mb-4">
                {error?.message || 'Issue不存在'}
              </p>
              <Button color="primary" onPress={() => router.push('/issues')}>
                返回列表
              </Button>
            </CardBody>
          </Card>
        </div>
      </>
    )
  }

  const { issue } = data
  const isAuthor = user?.id === issue.author.id

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 dark:bg-none dark:bg-background">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back button */}
          <Button
            variant="light"
            onPress={() => router.push('/issues')}
            className="mb-4"
          >
            ← 返回列表
          </Button>

          {/* Issue card */}
          <Card className="mb-6">
            <CardHeader className="flex justify-between items-start">
              <div className="flex-1">
                <h1 className="text-2xl font-bold mb-2">{issue.title}</h1>
                <div className="flex items-center gap-2 text-small text-default-500">
                  <Avatar
                    name={issue.author.nickname || issue.author.name}
                    size="sm"
                    className="w-6 h-6"
                  />
                  <span>{issue.author.nickname || issue.author.name}</span>
                  <span>·</span>
                  <span>创建于 {new Date(issue.createAt).toLocaleString('zh-CN')}</span>
                  {issue.updateAt !== issue.createAt && (
                    <>
                      <span>·</span>
                      <span>更新于 {new Date(issue.updateAt).toLocaleString('zh-CN')}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Chip color={issue.status ? 'success' : 'default'} variant="flat">
                  {issue.status ? '开放' : '已关闭'}
                </Chip>
                {isAuthor && (
                  <Button
                    size="sm"
                    color={issue.status ? 'default' : 'success'}
                    onPress={handleToggleStatus}
                  >
                    {issue.status ? '关闭' : '重新开放'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardBody>
              <div className="prose dark:prose-invert max-w-none">
                {renderContent(issue.content, issue.batches).map((part, idx) => (
                  typeof part === 'string' ? (
                    <p key={idx} className="whitespace-pre-wrap">{part}</p>
                  ) : (
                    <div key={idx}>{part}</div>
                  )
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Comments section */}
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">
                评论 ({issue.comments.length})
              </h2>
            </CardHeader>
            <CardBody>
              {/* Comment form */}
              {isAuthenticated() ? (
                issue.status ? (
                  <div className="mb-6">
                    <Textarea
                      placeholder="写下你的评论... (支持引用批次，如 @batch-abc123)"
                      value={comment}
                      onValueChange={setComment}
                      minRows={3}
                      className="mb-2"
                    />
                    <div className="flex justify-end">
                      <Button
                        color="primary"
                        onPress={handleSubmitComment}
                        isDisabled={!comment.trim() || isSubmitting}
                        isLoading={isSubmitting}
                      >
                        发表评论
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-6 p-4 bg-default-100 rounded-lg text-center">
                    <p className="text-default-500">该讨论已关闭，无法添加新评论</p>
                  </div>
                )
              ) : (
                <div className="mb-6 p-4 bg-default-100 rounded-lg text-center">
                  <p className="text-default-500">请登录后发表评论</p>
                </div>
              )}

              <Divider className="my-4" />

              {/* Comments list */}
              <div className="space-y-4">
                {issue.comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <Avatar
                      name={comment.author.nickname || comment.author.name}
                      size="sm"
                      className="shrink-0"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-small">
                          {comment.author.nickname || comment.author.name}
                        </span>
                        <span className="text-tiny text-default-400">
                          {new Date(comment.createAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <div className="text-default-700">
                        {renderContent(comment.content, issue.batches).map((part, idx) => (
                          typeof part === 'string' ? (
                            <p key={idx} className="whitespace-pre-wrap">{part}</p>
                          ) : (
                            <div key={idx}>{part}</div>
                          )
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {issue.comments.length === 0 && (
                  <div className="text-center py-8 text-default-400">
                    暂无评论
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </main>
      </div>
    </>
  )
}
