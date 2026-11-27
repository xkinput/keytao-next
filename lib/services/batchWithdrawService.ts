import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const BOT_SUBMIT_APPROVAL_REASON = '本喵根据逐条审核记录标记通过'

type WithdrawBatchSnapshot = {
  id: string
  itemReviewStarted?: boolean | null
  reviewerId?: number | null
  reviewedAt?: Date | null
  syncTaskId?: string | null
}

type WithdrawQueryClient = Pick<Prisma.TransactionClient, 'pullRequest' | 'pullRequestReviewNote'>

/**
 * A batch marked `itemReviewStarted: true` solely by bot-submit pre-approvals
 * (zero human review notes, zero applied or rejected PRs) can still be recalled
 * back to Draft by its author until a human reviewer acts on it.
 */
export async function isBotPreapprovedOnlySubmittedBatch(
  db: WithdrawQueryClient,
  batch: WithdrawBatchSnapshot,
): Promise<boolean> {
  if (!batch.itemReviewStarted) return true
  if (batch.reviewerId != null || batch.reviewedAt != null || batch.syncTaskId != null) {
    return false
  }
  const blockedPr = await db.pullRequest.findFirst({
    where: {
      batchId: batch.id,
      OR: [
        { appliedAt: { not: null } },
        { status: 'Rejected' },
      ],
    },
    select: { id: true },
  })
  if (blockedPr) return false
  const humanOrNonBotNote = await db.pullRequestReviewNote.findFirst({
    where: {
      pullRequest: { batchId: batch.id },
      OR: [
        { reviewerId: { not: null } },
        { decision: { not: 'Approved' } },
        { reason: { not: BOT_SUBMIT_APPROVAL_REASON } },
      ],
    },
    select: { id: true },
  })
  return !humanOrNonBotNote
}

export async function resetBotPreapprovedItemsOnWithdraw(
  tx: WithdrawQueryClient,
  batchId: string,
): Promise<void> {
  await tx.pullRequest.updateMany({
    where: { batchId, status: 'Approved', appliedAt: null },
    data: { status: 'Pending' },
  })
  await tx.pullRequestReviewNote.deleteMany({
    where: {
      pullRequest: { batchId },
      reviewerId: null,
      decision: 'Approved',
      reason: BOT_SUBMIT_APPROVAL_REASON,
    },
  })
}

export async function withdrawBatchForUser(batchId: string, userId: number) {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } })
  if (!batch) {
    return { status: 404, body: { error: '批次不存在' } }
  }

  if (batch.creatorId !== userId) {
    return { status: 403, body: { error: '无权限' } }
  }

  if (batch.status !== 'Submitted') {
    return { status: 400, body: { error: '只能撤销已提交状态的批次' } }
  }
  const isBotPreapproved = Boolean(batch.itemReviewStarted)
  if (isBotPreapproved && !(await isBotPreapprovedOnlySubmittedBatch(prisma, batch))) {
    return { status: 409, body: { error: '批次已开始逐词审核，不能整批撤销' } }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (isBotPreapproved) {
      if (!(await isBotPreapprovedOnlySubmittedBatch(tx, batch))) {
        return { kind: 'item-review-started' as const }
      }
      const transitioned = await tx.batch.updateMany({
        where: {
          id: batchId,
          creatorId: userId,
          status: 'Submitted',
          itemReviewStarted: true,
          reviewerId: null,
          reviewedAt: null,
          syncTaskId: null,
          contentVersion: batch.contentVersion,
        },
        data: { status: 'Draft', itemReviewStarted: false, contentVersion: { increment: 1 } },
      })
      if (transitioned.count !== 1) return null
      await resetBotPreapprovedItemsOnWithdraw(tx, batchId)
      return { kind: 'ok' as const, batch: await tx.batch.findUniqueOrThrow({ where: { id: batchId } }) }
    }

    const transitioned = await tx.batch.updateMany({
      where: {
        id: batchId,
        creatorId: userId,
        status: 'Submitted',
        itemReviewStarted: false,
        contentVersion: batch.contentVersion,
      },
      data: { status: 'Draft', contentVersion: { increment: 1 } },
    })
    if (transitioned.count !== 1) return null
    return { kind: 'ok' as const, batch: await tx.batch.findUniqueOrThrow({ where: { id: batchId } }) }
  })

  if (updated && updated.kind === 'item-review-started') {
    return { status: 409, body: { error: '批次已开始逐词审核，不能整批撤销' } }
  }

  if (!updated) {
    return { status: 409, body: { error: '批次内容或状态已被其他操作修改，请刷新后重试' } }
  }

  return { status: 200, body: { batch: updated.batch } }
}
