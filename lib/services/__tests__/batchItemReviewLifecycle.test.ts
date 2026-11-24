import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { POST as botSubmit } from '@/app/api/bot/batches/[id]/submit/route'
import { POST as botAutoApprove } from '@/app/api/bot/batches/[id]/auto-approve/route'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { prisma } from '@/lib/prisma'
import { BatchContentLockedError } from '@/lib/services/batchContentGuard'
import { approveSubmittedBatch } from '@/lib/services/batchApprovalService'
import { ItemReviewError, recordItemReview, resubmitRejectedItem } from '@/lib/services/batchItemReview'
import { createGithubSyncTask } from '@/lib/services/githubAutoSyncService'
import { createTestBatch, createTestUser, seedPhrases } from '@/lib/test/helpers'

vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: vi.fn() }))

async function submit(batchId: string) {
  return prisma.batch.update({ where: { id: batchId }, data: { status: 'Submitted' } })
}

describe('item review lifecycle in PostgreSQL', () => {
  it.each(['admin', 'bot-auto', 'community-vote'] as const)('blocks %s finalization while a word is still pending', async mode => {
    const author = await createTestUser()
    const { batch } = await createTestBatch(author.id, [
      { action: 'Create', word: '待审词', code: 'dsci', type: 'Phrase' },
    ])
    await submit(batch.id)

    await expect(approveSubmittedBatch({ batchId: batch.id, mode, expectedContentVersion: 0 }))
      .rejects.toMatchObject({ status: 409, message: '尚有未完成审核的词条，不可提交审核结果' })
    expect(await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({ status: 'Submitted' })
    expect(await prisma.phrase.count({ where: { userId: author.id } })).toBe(0)
  })

  it.each([false, true])('persists the exact bot approvals before finalizing (all approved: %s)', async allApproved => {
    const author = await createTestUser()
    const { batch, prs: [first, second] } = await createTestBatch(author.id, [
      { action: 'Create', word: '核验词', code: 'hyci', type: 'Phrase' },
      { action: 'Create', word: '检查词', code: 'jcci', type: 'Phrase' },
    ])
    vi.mocked(requireVerifiedBotUser).mockResolvedValue({
      authorized: true,
      platform: 'qq',
      user: { id: author.id, name: author.name, nickname: null, roles: [] },
    })
    const context = { params: Promise.resolve({ id: batch.id }) }
    const request = (action: string, body: object) =>
      new NextRequest(`http://localhost/api/bot/batches/${batch.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ platform: 'qq', platformId: '123', ...body }),
      })
    const approvedItemIds = allApproved ? [first.id, second.id] : [first.id]
    const payload = { approvedItemIds, expectedContentVersion: batch.contentVersion }
    const preview = await botSubmit(request('submit', { ...payload, previewOnly: true }), context)
    expect(preview.status).toBe(400)
    const { snapshotDigest, warningDigest } = await preview.json()
    const confirmation = {
      ...payload, confirmed: true, expectedSnapshotDigest: snapshotDigest, expectedWarningDigest: warningDigest,
    }
    const changed = await botSubmit(request('submit', { ...confirmation, approvedItemIds: [second.id] }), context)
    expect(changed.status).toBe(409)
    expect(await prisma.pullRequestReviewNote.count({ where: { pullRequestId: first.id } })).toBe(0)
    const submitted = await botSubmit(request('submit', confirmation), context)
    expect(submitted.status).toBe(200)
    const { approvedItemIds: savedItems, batch: savedBatch } = await submitted.json()
    expect(savedItems).toEqual(approvedItemIds)
    expect(await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } }))
      .toMatchObject({ status: 'Submitted', itemReviewStarted: true, contentVersion: batch.contentVersion + 1 })
    const items = await prisma.pullRequest.findMany({
      where: { batchId: batch.id },
      orderBy: { id: 'asc' },
      select: { status: true, appliedAt: true, reviewNotes: { select: { decision: true } } },
    })
    const approved = { status: 'Approved', appliedAt: null, reviewNotes: [{ decision: 'Approved' }] }
    expect(items).toEqual([approved, allApproved ? approved : { status: 'Pending', appliedAt: null, reviewNotes: [] }])
    const finalized = await botAutoApprove(request('auto-approve', { expectedContentVersion: savedBatch.contentVersion }), context)
    expect(finalized.status).toBe(allApproved ? 200 : 409)
    expect(await prisma.phrase.count({ where: { userId: author.id } })).toBe(allApproved ? 2 : 0)
  })

  it('applies approved entries only, and reopens a rejected entry in the same batch with its history', async () => {
    const author = await createTestUser()
    const reviewer = await createTestUser()
    const { batch, prs: [first, second] } = await createTestBatch(author.id, [
      { action: 'Create', word: '保留词', code: 'blci', type: 'Phrase' },
      { action: 'Create', word: '再审词', code: 'zeci', type: 'Phrase' },
    ])
    await submit(batch.id)
    await prisma.pullRequest.update({
      where: { id: second.id },
      data: { likedBy: { connect: { id: reviewer.id } } },
    })

    const review = (itemId: number, decision: 'Approved' | 'Rejected', reason: string, expectedContentVersion: number) =>
      recordItemReview({ batchId: batch.id, itemId, reviewerId: reviewer.id, decision, reason, expectedContentVersion })
    const finalize = (expectedContentVersion: number) =>
      approveSubmittedBatch({ batchId: batch.id, reviewerId: reviewer.id, expectedContentVersion })

    await review(first.id, 'Approved', '词义明确', 0)
    await expect(prisma.batch.update({ where: { id: batch.id }, data: { status: 'Approved' } }))
      .rejects.toThrow('Item review requires a versioned finalization')
    await expect(finalize(1)).rejects.toBeInstanceOf(ItemReviewError)
    expect(await prisma.phrase.count({ where: { userId: author.id } })).toBe(0)

    await review(second.id, 'Rejected', '依据不足', 1)
    const { batch: finalized } = await finalize(2)
    expect(finalized.status).toBe('Approved')

    const applied = await prisma.pullRequest.findUniqueOrThrow({ where: { id: first.id } })
    const originalPhrase = await prisma.phrase.findFirstOrThrow({ where: { word: '保留词', code: 'blci' } })
    expect(applied.appliedAt).toBeInstanceOf(Date)
    expect(await prisma.phrase.count({ where: { word: '再审词', code: 'zeci' } })).toBe(0)

    await resubmitRejectedItem(batch.id, second.id, author.id, finalized.contentVersion)
    const reopened = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })
    expect(reopened.status).toBe('Submitted')
    const resubmitted = await prisma.pullRequest.findUniqueOrThrow({
      where: { id: second.id },
      include: { likedBy: true, dislikedBy: true },
    })
    expect(resubmitted).toMatchObject({
      batchId: batch.id, status: 'Pending', appliedAt: null, likedBy: [], dislikedBy: [],
    })

    await review(second.id, 'Approved', '补齐出处', reopened.contentVersion)
    expect((await finalize(reopened.contentVersion + 1)).batch.status).toBe('Approved')

    expect(await prisma.phrase.findMany({
      where: { userId: author.id },
      orderBy: { id: 'asc' },
      select: { id: true, word: true },
    })).toEqual([
      { id: originalPhrase.id, word: '保留词' },
      { id: expect.any(Number), word: '再审词' },
    ])
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: first.id } }))
      .toMatchObject({ appliedAt: applied.appliedAt })
    expect(await prisma.pullRequestReviewNote.findMany({
      where: { pullRequestId: second.id },
      orderBy: { id: 'asc' },
      select: { decision: true, reason: true, reviewerId: true },
    })).toEqual([
      { decision: 'Rejected', reason: '依据不足', reviewerId: reviewer.id },
      { decision: 'Approved', reason: '补齐出处', reviewerId: reviewer.id },
    ])
  })

  it('preserves old resubmissions and approvals while requiring versioned manual sync claims', async () => {
    const author = await createTestUser()
    const reviewer = await createTestUser()
    const { batch: legacy, prs: [legacyItem] } = await createTestBatch(author.id, [
      { action: 'Create', word: '旧版词', code: 'jbci', type: 'Phrase' },
    ])
    await prisma.batch.update({ where: { id: legacy.id }, data: { status: 'Rejected' } })
    await prisma.pullRequest.update({ where: { id: legacyItem.id }, data: { status: 'Rejected' } })
    await submit(legacy.id)
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: legacyItem.id } }))
      .toMatchObject({ status: 'Pending', appliedAt: null })

    await prisma.batch.update({ where: { id: legacy.id }, data: { status: 'Approved' } })
    const approved = await prisma.pullRequest.update({ where: { id: legacyItem.id }, data: { status: 'Approved' } })
    expect(approved.appliedAt).toBeInstanceOf(Date)

    const { batch, prs: [item] } = await createTestBatch(author.id, [
      { action: 'Create', word: '新版词', code: 'xbci', type: 'Phrase' },
    ])
    await submit(batch.id)
    await recordItemReview({
      batchId: batch.id, itemId: item.id, reviewerId: reviewer.id,
      decision: 'Approved', reason: '核对完成', expectedContentVersion: 0,
    })
    const { batch: finalized } = await approveSubmittedBatch({
      batchId: batch.id, reviewerId: reviewer.id, expectedContentVersion: 1,
    })
    await expect(prisma.batch.update({ where: { id: batch.id }, data: { syncTaskId: 'legacy-claim' } }))
      .rejects.toThrow('Item review requires a versioned sync claim')
    const task = await createGithubSyncTask([
      { id: batch.id, contentVersion: finalized.contentVersion },
    ], ['keytao.phrase.dict.yaml'], 1)
    expect(await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } }))
      .toMatchObject({ syncTaskId: task.id, contentVersion: finalized.contentVersion + 1 })
  })

  it('refuses unfinished or mixed decisions for the two sides of a code move', async () => {
    const author = await createTestUser()
    const reviewer = await createTestUser()
    const [old] = await seedPhrases(author.id, [{ word: '迁移词', code: 'qyci', type: 'Phrase' }])
    const { batch, prs: [deleteOld, createNew] } = await createTestBatch(author.id, [
      { action: 'Delete', word: old.word, code: old.code, type: 'Phrase', phraseId: old.id },
      { action: 'Create', word: old.word, code: 'qyciov', type: 'Phrase' },
    ])
    await submit(batch.id)
    await prisma.pullRequestDependency.create({
      data: { dependentId: createNew.id, dependsOnId: deleteOld.id, reason: '迁移编码' },
    })

    const review = (itemId: number, decision: 'Approved' | 'Rejected', expectedContentVersion: number) =>
      recordItemReview({ batchId: batch.id, itemId, reviewerId: reviewer.id, decision, reason: '核对编码', expectedContentVersion })
    const finalize = (expectedContentVersion: number) =>
      approveSubmittedBatch({ batchId: batch.id, reviewerId: reviewer.id, expectedContentVersion })

    await review(deleteOld.id, 'Approved', 0)
    await expect(finalize(1)).rejects.toBeInstanceOf(ItemReviewError)
    await review(createNew.id, 'Rejected', 1)
    await expect(finalize(2)).rejects.toBeInstanceOf(ItemReviewError)
    expect(await prisma.phrase.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ code: old.code })
    expect(await prisma.phrase.count({ where: { word: old.word } })).toBe(1)

    await review(createNew.id, 'Approved', 2)
    expect((await finalize(3)).batch.status).toBe('Approved')
    expect(await prisma.phrase.findMany({
      where: { word: old.word },
      select: { code: true },
    })).toEqual([{ code: 'qyciov' }])
  })

  it('records only one decision when concurrent reviewers use the same stale version', async () => {
    const author = await createTestUser()
    const [first, second] = await Promise.all([createTestUser(), createTestUser()])
    const { batch, prs: [item] } = await createTestBatch(author.id, [
      { action: 'Create', word: '并发词', code: 'bfci', type: 'Phrase' },
    ])
    await submit(batch.id)

    const outcomes = await Promise.allSettled([
      recordItemReview({
        batchId: batch.id, itemId: item.id, reviewerId: first.id,
        decision: 'Approved', reason: '认同', expectedContentVersion: 0,
      }),
      recordItemReview({
        batchId: batch.id, itemId: item.id, reviewerId: second.id,
        decision: 'Rejected', reason: '待补', expectedContentVersion: 0,
      }),
    ])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(result => result.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(BatchContentLockedError)
    const stored = await prisma.pullRequest.findUniqueOrThrow({
      where: { id: item.id },
      include: { reviewNotes: true, batch: { select: { contentVersion: true } } },
    })
    expect(stored.batch?.contentVersion).toBe(1)
    expect(stored.reviewNotes).toHaveLength(1)
    expect(stored.reviewNotes[0].decision).toBe(stored.status)
  })
})
