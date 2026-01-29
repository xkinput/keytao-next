'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardHeader, CardBody, CardFooter, Input, Button, Divider } from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { apiRequest } from '@/lib/hooks/useSWR'

export default function RegisterPage() {
  const router = useRouter()
  const setAuth = useAuthStore((state) => state.setAuth)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await apiRequest<{ token: string; user: { id: number; name: string } }>(
        '/api/auth/register',
        {
          method: 'POST',
          body: { name, password, nickname, email },
          withAuth: false
        }
      )

      // Save token and user info to zustand store
      if (data.token && data.user) {
        setAuth(data.token, data.user)
      }

      router.push('/')
      router.refresh()
    } catch (err: unknown) {
      const error = err as { info?: { error?: string }; status?: number }
      setError(error.info?.error || '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100 dark:bg-none dark:bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col gap-1 items-center pb-6 pt-8">
          <h1 className="text-3xl font-bold">KeyTao</h1>
          <p className="text-small text-default-500">创建新账号</p>
        </CardHeader>

        <CardBody className="gap-4 px-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="用户名"
              placeholder="请输入用户名"
              value={name}
              onValueChange={setName}
              isRequired
              variant="bordered"
            />

            <Input
              label="密码"
              placeholder="请输入密码"
              type="password"
              value={password}
              onValueChange={setPassword}
              isRequired
              variant="bordered"
            />

            <Input
              label="昵称"
              placeholder="请输入昵称（可选）"
              value={nickname}
              onValueChange={setNickname}
              variant="bordered"
            />

            <Input
              label="邮箱"
              placeholder="请输入邮箱（可选）"
              type="email"
              value={email}
              onValueChange={setEmail}
              variant="bordered"
            />

            {error && (
              <p className="text-danger text-small">{error}</p>
            )}

            <Button
              type="submit"
              color="primary"
              size="lg"
              isLoading={loading}
              className="w-full"
            >
              注册
            </Button>
          </form>
        </CardBody>

        <Divider />

        <CardFooter className="flex justify-center px-8 py-6">
          <div className="flex items-center gap-1 text-small">
            <span>已有账号？</span>
            <Link href="/login" className="text-primary hover:underline">
              立即登录
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
