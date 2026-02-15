'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardHeader, CardBody, CardFooter, Input, Button, Divider } from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { apiRequest } from '@/lib/hooks/useSWR'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((state) => state.setAuth)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await apiRequest<{ token: string; user: { id: number; name: string } }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: { name, password },
          withAuth: false
        }
      )

      setAuth(data.token, data.user)

      router.push('/')
      router.refresh()
    } catch (err: unknown) {
      const error = err as { info?: { error?: string }; status?: number }
      setError(error.info?.error || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col gap-1 items-center pb-6 pt-8">
          <h1 className="text-3xl font-bold">KeyTao</h1>
          <p className="text-small text-default-500">登录到你的账号</p>
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
              登录
            </Button>
          </form>
        </CardBody>

        <Divider />

        <CardFooter className="flex flex-col gap-2 px-8 py-6">
          <div className="flex items-center justify-center gap-1 text-small">
            <span>还没有账号？</span>
            <Link href="/register" className="text-primary hover:underline">
              立即注册
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
