'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@heroui/react'
import { useAPI } from '@/lib/hooks/useSWR'
import { useAuthStore } from '@/lib/store/auth'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { token } = useAuthStore()

  // Use useAPI to verify admin access
  const { data, error, isLoading } = useAPI(
    token ? '/api/admin/stats' : null
  )

  useEffect(() => {
    if (!token) {
      router.replace('/login')
      return
    }

    if (!isLoading && (error || !data)) {
      router.replace('/')
    }
  }, [token, data, error, isLoading, router])

  if (!token || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" label="验证权限中..." />
      </div>
    )
  }

  if (error || !data) {
    return null
  }

  return <>{children}</>
}
