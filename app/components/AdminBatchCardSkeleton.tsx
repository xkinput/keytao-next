import { Card, CardBody, CardHeader, Skeleton } from '@heroui/react'

export default function AdminBatchCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex justify-between items-start">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="w-48 h-6 rounded-lg" />
            <Skeleton className="w-20 h-6 rounded-lg" />
          </div>
          <div className="flex items-center gap-4">
            <Skeleton className="w-32 h-4 rounded-lg" />
            <Skeleton className="w-24 h-4 rounded-lg" />
            <Skeleton className="w-36 h-4 rounded-lg" />
          </div>
        </div>
      </CardHeader>
    </Card>
  )
}
