import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/admin/batches/[id]/items/review-bulk/route'
import { prisma } from '@/lib/prisma'
import { writeMiaomiaoBatchReview } from '@/lib/services/batchBotReviewService'
import { recordItemReview, resubmitRejectedItem } from '@/lib/services/batchItemReview'
import { createTestBatch, createTestUser } from '@/lib/test/helpers'

const { checkAdminPermission } = vi.hoisted(() => ({ checkAdminPermission: vi.fn() }))
vi.mock('@/lib/adminAuth', () => ({ checkAdminPermission }))

async function createReviewedBatch(staleItem = false) {
  const [author, reviewer] = await Promise.all([createTestUser(), createTestUser()])
  const { batch, prs } = await createTestBatch(author.id, [
    { action: 'Create', word: '批量词', code: 'plci', type: 'Phrase' },
    { action: 'Create', word: '核对词', code: 'hdci', type: 'Phrase' },
  ])
  await writeMiaomiaoBatchReview({
    batch: { ...batch, pullRequests: prs.map(pr => ({ ...pr, weight: 100 })) },
    aiReview: {
      generatedAt: new Date().toISOString(),
      items: prs.map(pr => ({ prId: pr.id, status: 'pass', severity: 'success', title: '通过', reasons: [], suggestions: [] })),
    },
    expectedContentVersion: batch.contentVersion,
  })
  if (staleItem) {
    await prisma.pullRequest.update({ where: { id: prs[1].id }, data: { weight: 200 } })
  }
  const submitted = await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
  checkAdminPermission.mockResolvedValue({ authorized: true, session: { id: reviewer.id } })
  const itemIds = prs.map(pr => pr.id)
  const approve = (expectedContentVersion = submitted.contentVersion) => POST(
    new NextRequest(`http://localhost/api/admin/batches/${batch.id}/items/review-bulk`, {
      method: 'POST',
      body: JSON.stringify({ itemIds, expectedContentVersion }),
    }),
    { params: Promise.resolve({ id: batch.id }) },
  )
  return { submitted, reviewer, itemIds, approve }
}

async function readStoredReview(batchId: string) {
  return prisma.batch.findUniqueOrThrow({
    where: { id: batchId },
    select: {
      status: true, contentVersion: true, itemReviewStarted: true,
      pullRequests: {
        orderBy: { id: 'asc' },
        select: { status: true, appliedAt: true, reviewNotes: true },
      },
    },
  })
}

describe('bulk item approval in PostgreSQL', () => {
  it('approves the requested items and writes one signed note per item at one new version', async () => {
    const { submitted, reviewer, itemIds, approve } = await createReviewedBatch()
    const response = await approve()
    expect(response.status).toBe(200)
    const note = { decision: 'Approved', reason: '喵喵可放行档批量通过', reviewerId: reviewer.id }
    const items = itemIds.map(id => ({
      status: 'Approved', appliedAt: null,
      reviewNotes: [expect.objectContaining({ ...note, pullRequestId: id })],
    }))
    expect(await response.json()).toMatchObject({
      contentVersion: submitted.contentVersion + 1,
      items: items.map((item, index) => ({
        ...item, id: itemIds[index],
        reviewNotes: [expect.objectContaining({ ...note, reviewer: { name: reviewer.name, nickname: reviewer.nickname } })],
      })),
    })
    expect((await approve()).status).toBe(409)
    expect(await readStoredReview(submitted.id)).toEqual({
      status: 'Submitted', contentVersion: submitted.contentVersion + 1, itemReviewStarted: true, pullRequests: items,
    })
  })

  it('returns 409 and leaves the batch and notes untouched for a stale version', async () => {
    const { submitted, approve } = await createReviewedBatch()
    const before = await readStoredReview(submitted.id)
    const response = await approve(submitted.contentVersion - 1)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '批次内容已被其他操作修改，请刷新后重试' })
    expect(await readStoredReview(submitted.id)).toEqual(before)
  })

  it('returns the ineligible ID and rolls back the entire request when one digest is stale', async () => {
    const { submitted, itemIds, approve } = await createReviewedBatch(true)
    const before = await readStoredReview(submitted.id)
    const response = await approve()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: '部分词条不满足批量放行条件', ineligibleIds: [itemIds[1]],
    })
    expect(await readStoredReview(submitted.id)).toEqual(before)
  })

  it('returns the ineligible ID when a rejected item is resubmitted unchanged', async () => {
    const { submitted, reviewer, itemIds, approve } = await createReviewedBatch()
    const itemId = itemIds[1]
    await recordItemReview({
      batchId: submitted.id, itemId, reviewerId: reviewer.id,
      decision: 'Rejected', reason: '依据不足', expectedContentVersion: submitted.contentVersion,
    })
    await resubmitRejectedItem(submitted.id, itemId, submitted.creatorId, submitted.contentVersion + 1)

    const before = await readStoredReview(submitted.id)
    expect(before.pullRequests[1]).toMatchObject({ status: 'Pending', reviewNotes: [{ decision: 'Rejected' }] })
    const response = await approve(before.contentVersion)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: '部分词条不满足批量放行条件', ineligibleIds: [itemId],
    })
    expect(await readStoredReview(submitted.id)).toEqual(before)
  })
})
