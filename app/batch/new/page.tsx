'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@heroui/react'
import { apiRequest } from '@/lib/hooks/useSWR'

export default function NewBatchPage() {
  const router = useRouter()

  useEffect(() => {
    const createBatch = async () => {
      try {
        // Generate default name with timestamp
        const now = new Date()
        const defaultName = `修改批次 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

        const result = await apiRequest('/api/batches', {
          method: 'POST',
          body: { description: defaultName }
        }) as { batch: { id: string } }

        router.push(`/batch/${result.batch.id}`)
      } catch (err) {
        const error = err as Error
        alert(error.message || '创建失败')
        router.push('/')
      }
    }

    createBatch()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size="lg" label="正在创建批次..." />
    </div>
  )
}