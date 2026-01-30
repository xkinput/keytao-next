'use client'

import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Spinner
} from '@heroui/react'
import Navbar from '@/app/components/Navbar'
import { useAPI } from '@/lib/hooks/useSWR'

interface User {
  id: number
  name: string | null
  nickname: string | null
  email: string | null
  status: string
  createAt: string
}

export default function UsersPage() {
  const { data, isLoading } = useAPI<{ users: User[] }>('/api/admin/users')
  const users = data?.users || []

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ENABLE':
        return 'success'
      case 'DISABLE':
        return 'warning'
      case 'BANNED':
        return 'danger'
      default:
        return 'default'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ENABLE':
        return '正常'
      case 'DISABLE':
        return '禁用'
      case 'BANNED':
        return '封禁'
      default:
        return status
    }
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

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">用户管理</h1>
            <p className="text-default-500">共 {users.length} 个用户</p>
          </div>

          <Table aria-label="用户列表">
            <TableHeader>
              <TableColumn>ID</TableColumn>
              <TableColumn>用户名</TableColumn>
              <TableColumn>昵称</TableColumn>
              <TableColumn>邮箱</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn>注册时间</TableColumn>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.id}</TableCell>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.nickname || '-'}</TableCell>
                  <TableCell>{user.email || '-'}</TableCell>
                  <TableCell>
                    <Chip color={getStatusColor(user.status)} variant="flat" size="sm">
                      {getStatusText(user.status)}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    {new Date(user.createAt).toLocaleDateString('zh-CN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </main>
      </div>
    </>
  )
}
