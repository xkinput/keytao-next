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
  Spinner,
} from '@/lib/heroui-compat'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { useState } from 'react'
import { useAuthStore } from '@/lib/store/auth'

interface Role {
  id: number
  name: string
  value: string
}

interface User {
  id: number
  name: string | null
  nickname: string | null
  email: string | null
  status: string
  createAt: string
  roles: Role[]
  _count: { batches: number; pullRequests: number }
}

export default function UsersPage() {
  const { data, isLoading, mutate } = useAPI<{ users: User[] }>('/api/admin/users', { withAuth: true })
  const { isRootAdmin } = useAuthStore()
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const users = data?.users || []

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ENABLE': return 'success'
      case 'DISABLE': return 'warning'
      case 'BANNED': return 'danger'
      default: return 'default'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ENABLE': return '正常'
      case 'DISABLE': return '禁用'
      case 'BANNED': return '封禁'
      default: return status
    }
  }

  const handleToggleManager = async (user: User) => {
    setTogglingId(user.id)
    try {
      const hasManager = user.roles.some(r => r.value === 'R:MANAGER')
      await apiRequest(`/api/admin/users/${user.id}/role`, {
        method: 'PUT',
        body: { role: hasManager ? null : 'R:MANAGER' },
        withAuth: true,
      })
      await mutate()
    } catch (e) {
      console.error(e)
    } finally {
      setTogglingId(null)
    }
  }

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
            <TableColumn>角色</TableColumn>
            <TableColumn>批次</TableColumn>
            <TableColumn>词条</TableColumn>
            <TableColumn>注册时间</TableColumn>
            {isRootAdmin ? <TableColumn>操作</TableColumn> : <TableColumn> </TableColumn>}
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isRoot = user.roles.some(r => r.value === 'R:ROOT')
              const isManager = user.roles.some(r => r.value === 'R:MANAGER')
              return (
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
                    {isRoot ? (
                      <Chip color="danger" variant="flat" size="sm">初始管理员</Chip>
                    ) : isManager ? (
                      <Chip color="primary" variant="flat" size="sm">管理员</Chip>
                    ) : (
                      <span className="text-default-400 text-sm">普通用户</span>
                    )}
                  </TableCell>
                  <TableCell>{user._count.batches}</TableCell>
                  <TableCell>{user._count.pullRequests}</TableCell>
                  <TableCell>
                    {new Date(user.createAt).toLocaleDateString('zh-CN')}
                  </TableCell>
                  <TableCell>
                    {isRootAdmin && !isRoot && (
                      <Button
                        size="sm"
                        variant="flat"
                        color={isManager ? 'danger' : 'primary'}
                        isLoading={togglingId === user.id}
                        onPress={() => handleToggleManager(user)}
                      >
                        {isManager ? '移除管理员' : '设为管理员'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </main>
    </div>
  )
}
