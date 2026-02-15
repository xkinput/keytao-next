import { Card, CardBody, Skeleton } from '@heroui/react'

export default function IssueCardSkeleton() {
  return (
    <Card>
      <CardBody className="p-4 sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-start gap-4">
            <Skeleton className="h-7 w-3/4 rounded-lg" />
            <Skeleton className="h-6 w-16 rounded-lg shrink-0" />
          </div>

          <div className="space-y-2">
            <Skeleton className="h-4 w-full rounded-lg" />
            <Skeleton className="h-4 w-5/6 rounded-lg" />
          </div>

          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Skeleton className="w-6 h-6 rounded-full" />
                <Skeleton className="h-4 w-20 rounded-lg" />
              </div>
              <Skeleton className="h-4 w-1 rounded-lg" />
              <Skeleton className="h-4 w-24 rounded-lg" />
            </div>

            <div className="flex items-center gap-1">
              <Skeleton className="w-4 h-4 rounded-lg" />
              <Skeleton className="h-4 w-6 rounded-lg" />
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
