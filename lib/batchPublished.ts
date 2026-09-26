import type { Prisma } from '@prisma/client'

// A batch counts as published once the GitHub sync task that carried it completed.
export const PUBLISHED_BATCH_WHERE = {
  status: 'Approved',
  syncTask: { status: 'Completed' }
} satisfies Prisma.BatchWhereInput
