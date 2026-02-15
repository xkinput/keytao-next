import { Card, CardBody, Skeleton } from '@heroui/react'

export default function BatchCardSkeleton() {
  return (
    <Card>
      <CardBody className="gap-3">
        <div className="flex justify-between items-start">
          <div className="flex-1 space-y-2">
            <Skeleton className="w-3/5 rounded-lg">
              <div className="h-6 w-3/5 rounded-lg bg-default-200"></div>
            </Skeleton>
            <Skeleton className="w-2/5 rounded-lg">
              <div className="h-4 w-2/5 rounded-lg bg-default-200"></div>
            </Skeleton>
          </div>
          <Skeleton className="w-20 rounded-lg">
            <div className="h-6 w-20 rounded-lg bg-default-200"></div>
          </Skeleton>
        </div>

        <div className="flex gap-4 text-sm">
          <Skeleton className="w-24 rounded-lg">
            <div className="h-4 w-24 rounded-lg bg-default-200"></div>
          </Skeleton>
          <Skeleton className="w-32 rounded-lg">
            <div className="h-4 w-32 rounded-lg bg-default-200"></div>
          </Skeleton>
        </div>
      </CardBody>
    </Card>
  )
}
