import type { Prisma } from '@prisma/client'
import { BOT_BATCH_DESCRIPTION_PREFIX, botDraftBatchWhere } from '@/lib/services/botDraftBatch'

export const EDITABLE_BATCH_STATUSES = ['Draft', 'Rejected'] as const

export class BatchContentLockedError extends Error {
  readonly status = 409

  constructor(message = '批次内容已被其他操作修改，请刷新后重试') {
    super(message)
    this.name = 'BatchContentLockedError'
  }
}

export async function lockBotDraftUser(
  tx: Prisma.TransactionClient,
  userId: number
): Promise<void> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1, $2)', 0x4b54, userId)
}

export async function assertNoOtherBotDraftWithContent(
  tx: Prisma.TransactionClient,
  userId: number,
  batchId: string
): Promise<void> {
  const other = await tx.batch.findFirst({
    where: {
      id: { not: batchId },
      creatorId: userId,
      status: 'Draft',
      description: { startsWith: BOT_BATCH_DESCRIPTION_PREFIX },
      pullRequests: { some: {} },
    },
    select: { id: true },
  })
  if (other) {
    throw new BatchContentLockedError('当前已有另一个含内容的助手草稿，请刷新后重试')
  }
}

/**
 * CAS check for a write that creates the user's first bot draft.
 *
 * The caller's plan was built against "this user has no draft batch"
 * (`expectedContentVersion: 0` with no `batchId`). Re-check that under the
 * per-user advisory lock before creating one, so two concurrent first writes
 * cannot each create their own draft.
 */
export async function assertNoBotDraftBatch(
  tx: Prisma.TransactionClient,
  userId: number
): Promise<void> {
  const existing = await tx.batch.findFirst({
    where: botDraftBatchWhere(userId),
    select: { id: true },
  })
  if (existing) {
    throw new BatchContentLockedError('草稿批次已变化，请刷新后重试')
  }
}

export async function claimBatchContentMutation(
  tx: Prisma.TransactionClient,
  batchId: string,
  options: {
    creatorId?: number
    expectedContentVersion: number
    allowedStatuses?: readonly string[]
  }
): Promise<void> {
  const allowedStatuses = options.allowedStatuses ?? EDITABLE_BATCH_STATUSES
  const claimed = await tx.batch.updateMany({
    where: {
      id: batchId,
      ...(options.creatorId === undefined ? {} : { creatorId: options.creatorId }),
      contentVersion: options.expectedContentVersion,
      status: { in: allowedStatuses as Prisma.EnumBatchStatusFilter['in'] },
    },
    data: { contentVersion: { increment: 1 } },
  })

  if (claimed.count !== 1) {
    throw new BatchContentLockedError()
  }
}
