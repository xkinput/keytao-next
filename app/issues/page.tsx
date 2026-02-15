'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  CardBody,
  Button,
  Spinner,
  Chip,
  useDisclosure,
  Avatar,
} from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI } from '@/lib/hooks/useSWR'
import { usePageFilterStore } from '@/lib/store/pageFilter'
import { useRouter } from 'next/navigation'
import Navbar from '@/app/components/Navbar'
import CreateIssueModal from '@/app/components/CreateIssueModal'

interface Issue {
  id: number
  title: string
  content: string
  status: boolean
  createAt: string
  author: {
    id: number
    name: string
    nickname: string | null
  }
  _count: {
    comments: number
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

const truncateContent = (content: string, maxLength: number = 200) => {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
}

function MessageCircleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  )
}

export default function HomePage() {
  const { isAuthenticated } = useAuthStore()
  const { getPage, setPage: setStorePage } = usePageFilterStore()
  const [page, setPage] = useState(() => getPage('/issues', 1))
  const router = useRouter()

  // Sync page changes to store
  useEffect(() => {
    setStorePage('/issues', page)
  }, [page, setStorePage])

  const { data, error, isLoading, mutate } = useAPI<IssuesResponse>(
    `/api/issues?page=${page}&pageSize=10`
  )

  const { isOpen, onOpen, onClose } = useDisclosure()

  const getStatusColor = (status: boolean) => {
    return status ? 'success' : 'default'
  }

  const getStatusText = (status: boolean) => {
    return status ? '开放' : '已关闭'
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
              <h2 className="text-2xl font-bold mb-2">讨论</h2>
              <p className="text-default-500">
                共 {data?.pagination.total || 0} 个讨论
              </p>
            </div>
            {isAuthenticated() && (
              <Button color="primary" onPress={onOpen}>
                新建讨论
              </Button>
            )}
          </div>

          {error && (
            <div className="mb-4 p-4 bg-danger-50 dark:bg-danger-100/10 text-danger rounded-lg">
              获取讨论失败: {error.message}
            </div>
          )}

          <div className="grid gap-4">
            {data?.issues.map((issue) => (
              <Card
                key={issue.id}
                isPressable
                onPress={() => router.push(`/issues/${issue.id}`)}
                className="w-full hover:scale-[1.01] transition-transform"
                shadow="sm"
              >
                <CardBody className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-start gap-4">
                      <h3 className="text-lg sm:text-xl font-bold text-default-900 leading-tight">
                        {issue.title}
                      </h3>
                      <Chip
                        color={getStatusColor(issue.status)}
                        variant="flat"
                        size="sm"
                        className="flex-shrink-0"
                      >
                        {getStatusText(issue.status)}
                      </Chip>
                    </div>

                    <p className="text-default-500 text-sm line-clamp-2">
                      {truncateContent(issue.content)}
                    </p>

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={issue.author.nickname || issue.author.name}
                            size="sm"
                            className="w-6 h-6 text-tiny"
                          />
                          <span className="text-small text-default-500 font-medium">
                            {issue.author.nickname || issue.author.name}
                          </span>
                        </div>
                        <span className="text-small text-default-400">·</span>
                        <span className="text-small text-default-400">
                          {new Date(issue.createAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-default-400">
                        <MessageCircleIcon className="w-4 h-4" />
                        <span className="text-small">{issue._count?.comments || 0}</span>
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}

            {data?.issues.length === 0 && !isLoading && (
              <Card>
                <CardBody className="text-center py-16">
                  <div className="flex flex-col items-center justify-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-default-100 flex items-center justify-center">
                      <MessageCircleIcon className="w-8 h-8 text-default-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-default-700">暂无讨论</h3>
                      <p className="text-default-500">
                        还没有人发起讨论，来做第一个发言的人吧
                      </p>
                    </div>
                    {isAuthenticated() && (
                      <Button color="primary" onPress={onOpen} className="mt-2">
                        发起讨论
                      </Button>
                    )}
                  </div>
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

        <CreateIssueModal
          isOpen={isOpen}
          onClose={onClose}
          onSuccess={mutate}
        />
      </div>
    </>
  )
}
