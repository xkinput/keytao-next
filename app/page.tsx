'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Chip,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Textarea,
  useDisclosure
} from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import Navbar from '@/app/components/Navbar'

interface Issue {
  id: number
  title: string
  content: string
  status: 'OPEN' | 'CLOSED' | 'IN_PROGRESS'
  createAt: string
  author: {
    id: number
    name: string
    nickname: string | null
  }
}

interface IssuesResponse {
  issues: Issue[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default function HomePage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [page, setPage] = useState(1)
  const [isClient, setIsClient] = useState(false)

  const { data, error, isLoading, mutate } = useAPI<IssuesResponse>(
    isClient ? `/api/issues?page=${page}&pageSize=10` : null
  )
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Handle client-side hydration
  useEffect(() => {
    setIsClient(true)
  }, [])

  // No authentication redirect - homepage is public

  const handleCreateIssue = async () => {
    if (!isAuthenticated()) {
      alert('请先登录')
      router.push('/login')
      return
    }

    if (!title || !content) return

    setSubmitting(true)
    try {
      await apiRequest('/api/issues', {
        method: 'POST',
        body: { title, content }
      })

      setTitle('')
      setContent('')
      onClose()
      mutate() // Refresh the issues list
    } catch {
      alert('创建 issue 失败')
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN':
        return 'success'
      case 'CLOSED':
        return 'default'
      case 'IN_PROGRESS':
        return 'warning'
      default:
        return 'default'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'OPEN':
        return '开放'
      case 'CLOSED':
        return '已关闭'
      case 'IN_PROGRESS':
        return '进行中'
      default:
        return status
    }
  }

  // Show loading during SSR/hydration
  if (!isClient) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size="lg" label="加载中..." />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size="lg" label="正在加载数据..." />
      </div>
    )
  }

  if (error && error.status !== 401) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <Card className="max-w-md">
          <CardBody className="text-center">
            <p className="text-danger mb-4">加载失败</p>
            <p className="text-default-500 mb-4">{error.message || '发生未知错误'}</p>
            <Button color="primary" onPress={() => mutate()}>
              重试
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 dark:bg-none dark:bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">Issues</h2>
              <p className="text-default-500">
                共 {data?.pagination.total || 0} 个 issue
              </p>
            </div>
            {isAuthenticated() && (
              <Button color="primary" onPress={onOpen}>
                新建 Issue
              </Button>
            )}
          </div>

          {error && (
            <div className="mb-4 p-4 bg-danger-50 dark:bg-danger-100/10 text-danger rounded-lg">
              获取 issues 失败: {error.message}
            </div>
          )}

          <div className="grid gap-4">
            {data?.issues.map((issue) => (
              <Card key={issue.id}>
                <CardHeader className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{issue.title}</h3>
                    <p className="text-small text-default-500">
                      由 {issue.author.nickname || issue.author.name} 创建于{' '}
                      {new Date(issue.createAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <Chip color={getStatusColor(issue.status)} variant="flat">
                    {getStatusText(issue.status)}
                  </Chip>
                </CardHeader>
                <CardBody>
                  <p className="text-default-700 whitespace-pre-wrap">
                    {issue.content}
                  </p>
                </CardBody>
              </Card>
            ))}

            {data?.issues.length === 0 && !isLoading && (
              <Card>
                <CardBody className="text-center py-12">
                  <p className="text-default-500">暂无 issue</p>
                </CardBody>
              </Card>
            )}
          </div>

          {data?.pagination && data.pagination.totalPages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              <Button
                isDisabled={data.pagination.page === 1}
                onPress={() => setPage(data.pagination.page - 1)}
              >
                上一页
              </Button>
              <span className="flex items-center px-4">
                {data.pagination.page} / {data.pagination.totalPages}
              </span>
              <Button
                isDisabled={data.pagination.page === data.pagination.totalPages}
                onPress={() => setPage(data.pagination.page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </main>

        <Modal isOpen={isOpen} onClose={onClose} size="2xl">
          <ModalContent>
            <ModalHeader>新建 Issue</ModalHeader>
            <ModalBody>
              <Input
                label="标题"
                placeholder="请输入 issue 标题"
                value={title}
                onValueChange={setTitle}
                isRequired
              />
              <Textarea
                label="内容"
                placeholder="请输入 issue 内容"
                value={content}
                onValueChange={setContent}
                isRequired
                minRows={6}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                取消
              </Button>
              <Button
                color="primary"
                onPress={handleCreateIssue}
                isLoading={submitting}
                isDisabled={!title || !content}
              >
                创建
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    </>
  )
}
