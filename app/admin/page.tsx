'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@heroui/react'

export default function AdminPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/admin/dashboard')
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" label="跳转中..." />
    </div>
  )
}
