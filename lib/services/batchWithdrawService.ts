import { prisma } from '@/lib/prisma'

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
  if (batch.itemReviewStarted) {
    return { status: 409, body: { error: '批次已开始逐词审核，不能整批撤销' } }
  }

  const updated = await prisma.$transaction(async (tx) => {
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
    return tx.batch.findUniqueOrThrow({ where: { id: batchId } })
  })

  if (!updated) {
    return { status: 409, body: { error: '批次内容或状态已被其他操作修改，请刷新后重试' } }
  }

  return { status: 200, body: { batch: updated } }
}
