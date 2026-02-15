import { TableRow, TableCell, Skeleton } from '@heroui/react'

export default function PhraseTableRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="w-24 h-4 rounded-lg" />
      </TableCell>
      <TableCell>
        <Skeleton className="w-20 h-4 rounded-lg" />
      </TableCell>
      <TableCell>
        <Skeleton className="w-16 h-6 rounded-lg" />
      </TableCell>
      <TableCell>
        <Skeleton className="w-12 h-4 rounded-lg" />
      </TableCell>
      <TableCell>
        <Skeleton className="w-16 h-6 rounded-lg" />
      </TableCell>
      <TableCell>
        <Skeleton className="w-32 h-4 rounded-lg" />
      </TableCell>
    </TableRow>
  )
}
