import { Card, CardBody, CardHeader, Skeleton } from '@heroui/react'

export default function PullRequestCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex justify-between items-start">
        <div className="flex items-center gap-2 flex-1">
          <Skeleton className="w-16 h-6 rounded-lg" />
          <Skeleton className="w-32 h-6 rounded-lg" />
          <Skeleton className="w-8 h-4 rounded-lg" />
          <Skeleton className="w-24 h-6 rounded-lg" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="w-20 h-6 rounded-lg" />
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex items-center gap-4">
          <Skeleton className="w-48 h-4 rounded-lg" />
          <Skeleton className="w-32 h-4 rounded-lg" />
        </div>
      </CardBody>
    </Card>
  )
}
