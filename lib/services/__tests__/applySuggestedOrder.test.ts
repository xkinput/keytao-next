import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/admin/batches/[id]/items/[itemId]/apply-order/route'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createTestBatch, createTestUser } from '@/lib/test/helpers'
import { getAdminBatchReviewDetail } from '../adminBatchReviewDetailService'
import { buildMiaomiaoItemReviewContext, computeChainDigest, hasCurrentMiaomiaoPass } from '../batchAiReviewService'
import { approveSubmittedBatch } from '../batchApprovalService'
import { computeReviewDigest, formatMiaomiaoReviewRemark } from '../batchBotReviewService'
import { checkBatchConflictsWithWeight } from '../batchConflictService'
import { recordItemReview } from '../batchItemReview'
import { parseMiaomiaoReviewRemark } from '../miaomiaoReviewRemark'
import { applySuggestedOrder } from '../suggestedOrderService'

vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSession: vi.fn(),
}))

const code = 'pxci'
const type = 'Phrase' as const
const generatedAt = '2026-11-25T00:00:00.000Z'
const orderedWords = ['优先词', '较早词', '现有词', '末尾词']

async function setup() {
  const [author, reviewer] = await Promise.all([createTestUser(), createTestUser()])
  await prisma.user.update({
    where: { id: reviewer.id },
    data: { roles: { connectOrCreate: { where: { value: 'R:MANAGER' }, create: { value: 'R:MANAGER', name: 'Manager' } } } },
  })
  vi.mocked(getSession).mockResolvedValue({ id: reviewer.id, name: reviewer.name! })
  const current = await prisma.phrase.create({
    data: { word: '现有词', code, type, weight: 105, status: 'Finish', userId: author.id },
  })
  const { batch, prs: [fresh, stale, retained, other, applied] } = await createTestBatch(author.id, [
    { action: 'Create', word: '优先词', code, type },
    { action: 'Create', word: '较早词', code, type, weight: 110 },
    { action: 'Create', word: '末尾词', code, type },
    { action: 'Create', word: '其他词', code, type: 'Supplement' },
    { action: 'Create', word: '历史词', code, type },
  ])
  await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
  await prisma.pullRequest.update({ where: { id: applied.id }, data: { status: 'Approved', appliedAt: new Date(generatedAt) } })
  await recordItemReview({
    batchId: batch.id, itemId: stale.id, reviewerId: reviewer.id, decision: 'Approved',
    reason: 'Reviewed before ordering', expectedContentVersion: batch.contentVersion,
  })
  const version = batch.contentVersion + 1
  const detail = await getAdminBatchReviewDetail(batch.id)
  const { codeChains } = await buildMiaomiaoItemReviewContext(detail!.pullRequests.filter(pr => !pr.appliedAt))
  const chainDigest = computeChainDigest(codeChains.find(chain => chain.code === code && chain.type === type)!.after)
  const order = { code, type, orderedWords, chainDigest }
  const staleDigest = computeReviewDigest({ ...stale, weight: 777 })
  for (const [index, pr] of [fresh, stale, retained, other, applied].entries()) {
    const digest = pr.id === stale.id ? staleDigest : computeReviewDigest(pr)
    const suggestedOrder = pr.id === other.id ? { ...order, type: 'Supplement' } : order
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: {
        createAt: new Date(Date.parse(generatedAt) + index),
        remark: 'Original remark\n\n' + formatMiaomiaoReviewRemark({
          prId: pr.id, status: 'pass', severity: 'success', title: 'Reviewed',
          reasons: ['Original reason'], suggestions: [], suggestedOrder,
        }, generatedAt, digest),
        likedBy: { connect: { id: author.id } },
        dislikedBy: { connect: { id: reviewer.id } },
      },
    })
  }
  const apply = (digest = chainDigest, expectedContentVersion = version) => POST(
    new NextRequest(`http://localhost/api/admin/batches/${batch.id}/items/${fresh.id}/apply-order`, {
      method: 'POST', body: JSON.stringify({ chainDigest: digest, expectedContentVersion }),
    }),
    { params: Promise.resolve({ id: batch.id, itemId: String(fresh.id) }) },
  )
  return { batchId: batch.id, reviewer, author, current, fresh, stale, retained, other, version, apply, staleDigest }
}

function storedBatch(id: string) {
  return prisma.batch.findUniqueOrThrow({
    where: { id },
    include: { pullRequests: { orderBy: { id: 'asc' }, include: {
      reviewNotes: true, _count: { select: { likedBy: true, dislikedBy: true } },
    } } },
  })
}

describe('apply suggested order in PostgreSQL', () => {
  it('updates the chain once during review and preserves the order through approval', async () => {
    const { batchId, reviewer, current, fresh, stale, retained, other, version, apply, staleDigest } = await setup()
    const before = await storedBatch(batchId)
    expect(before.itemReviewStarted).toBe(true)
    const detail = await getAdminBatchReviewDetail(batchId)
    expect(detail?.pullRequests.filter(item => 'suggestedOrderApplicable' in item && item.suggestedOrderApplicable)
      .map(item => item.id)).toEqual([fresh.id, stale.id, retained.id])

    const response = await apply()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      contentVersion: version + 1,
      items: [
        { id: fresh.id, status: 'Pending', weight: 103, reviewFresh: true, reviewNotes: [] },
        { id: stale.id, status: 'Approved', weight: 104, reviewFresh: false, reviewNotes: [
          { reason: 'Reviewed before ordering', reviewer: { name: reviewer.name, nickname: reviewer.nickname } },
        ] },
        { id: retained.id, status: 'Pending', weight: null, reviewFresh: true, reviewNotes: [] },
      ],
    })
    const saved = await storedBatch(batchId)
    expect(saved).toMatchObject({ contentVersion: version + 1, itemReviewStarted: true, status: 'Submitted' })
    const [savedFresh, savedStale, savedRetained, savedOther, savedApplied] = saved.pullRequests
    const cleared = { likedBy: 0, dislikedBy: 0 }
    expect(saved.pullRequests.map(item => item._count)).toEqual([
      cleared, cleared, { likedBy: 1, dislikedBy: 1 }, { likedBy: 1, dislikedBy: 1 }, { likedBy: 1, dislikedBy: 1 },
    ])
    for (const item of [savedFresh, savedStale, savedRetained]) {
      expect(item.remark).not.toContain('排序：')
      expect(parseMiaomiaoReviewRemark(item.remark)).toMatchObject({
        baseRemark: 'Original remark', review: { reason: 'Original reason', generatedAt },
      })
    }
    expect(hasCurrentMiaomiaoPass(savedFresh)).toBe(true)
    expect(parseMiaomiaoReviewRemark(savedStale.remark).review?.reviewDigest).toBe(staleDigest)
    expect(hasCurrentMiaomiaoPass(savedStale)).toBe(false)
    expect(savedStale.reviewNotes).toEqual(before.pullRequests[1].reviewNotes)
    expect(savedOther).toEqual(before.pullRequests[3])
    expect(savedApplied).toEqual(before.pullRequests[4])
    expect(savedApplied.remark).toContain('排序：')
    expect(await prisma.phrase.findUniqueOrThrow({ where: { id: current.id } })).toEqual(current)

    let nextVersion = version + 1
    for (const item of [fresh, retained, other]) {
      await recordItemReview({
        batchId, itemId: item.id, reviewerId: reviewer.id, decision: 'Approved',
        reason: 'Reviewed after ordering', expectedContentVersion: nextVersion++,
      })
    }
    expect((await approveSubmittedBatch({ batchId, reviewerId: reviewer.id, expectedContentVersion: nextVersion })).batch.status)
      .toBe('Approved')
    expect(await prisma.phrase.findMany({
      where: { code, type }, select: { word: true, weight: true }, orderBy: { weight: 'asc' },
    })).toEqual(orderedWords.map((word, index) => ({ word, weight: [103, 104, 105, 108][index] })))
  })

  it.each(['Delete', 'Change'] as const)('finalizes after rejecting the %s whose old weight was reserved', async action => {
    const [author, reviewer] = await Promise.all([createTestUser(), createTestUser()])
    const live = action === 'Delete'
      ? [{ word: '前词', weight: 100 }, { word: '甲词', weight: 102 }, { word: '中词', weight: 103 },
        { word: '乙词', weight: 105 }, { word: '后词', weight: 106 }]
      : [{ word: '前词', weight: 100 }, { word: '甲词', weight: 103 }, { word: '乙词', weight: 104 }, { word: '后词', weight: 107 }]
    await prisma.phrase.createMany({ data: live.map(entry => ({ ...entry, code, type, status: 'Finish', userId: author.id })) })

    const create = { action: 'Create', word: '新词', code, type } as const
    // Choose a Delete that the Create's re-code warning does not link as a review dependency.
    const [probe] = action === 'Delete' ? await checkBatchConflictsWithWeight([{ id: '1', ...create }]) : []
    const deleted = probe?.conflict.currentPhrase?.word === '甲词' ? '乙词' : '甲词'
    const { batch, prs: [rejected, approved] } = await createTestBatch(author.id, action === 'Delete'
      ? [{ action: 'Delete', word: deleted, code, type }, create]
      : [{ action: 'Change', oldWord: '甲词', word: '新甲', code, type, weight: 101 },
        { action: 'Change', oldWord: '乙词', word: '新乙', code, type, weight: 103 }])
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
    const detail = await getAdminBatchReviewDetail(batch.id)
    const { codeChains: [chain] } = await buildMiaomiaoItemReviewContext(detail!.pullRequests)
    const chainDigest = computeChainDigest(chain.after)
    const words = action === 'Delete' ? live.map(entry => entry.word === deleted ? create.word : entry.word)
      : ['前词', '新乙', '新甲', '后词']
    await prisma.pullRequest.update({ where: { id: approved.id }, data: { remark: formatMiaomiaoReviewRemark({
      prId: approved.id, status: 'pass', severity: 'success', title: 'Reviewed', reasons: [], suggestions: [],
      suggestedOrder: { code, type, orderedWords: words, chainDigest },
    }, generatedAt, computeReviewDigest(approved)) } })
    const eligible = await getAdminBatchReviewDetail(batch.id)
    expect(eligible?.pullRequests.find(row => row.id === approved.id)).toMatchObject({ suggestedOrderApplicable: true })

    const applied = await applySuggestedOrder({ batchId: batch.id, itemId: approved.id, chainDigest,
      expectedContentVersion: batch.contentVersion })
    const safeWeight = action === 'Change' ? 105 : deleted === '甲词' ? 101 : 104
    expect(applied.items).toContainEqual(expect.objectContaining({ id: approved.id, weight: safeWeight }))
    let version = applied.contentVersion
    for (const [item, decision] of [[rejected, 'Rejected'], [approved, 'Approved']] as const) {
      await recordItemReview({ batchId: batch.id, itemId: item.id, reviewerId: reviewer.id, decision,
        reason: 'Reviewed after ordering', expectedContentVersion: version++ })
    }
    await expect(approveSubmittedBatch({ batchId: batch.id, reviewerId: reviewer.id, expectedContentVersion: version }))
      .resolves.toMatchObject({ batch: { status: 'Approved' } })
    expect(await prisma.phrase.findMany({ where: { code, type }, select: { word: true, weight: true } }))
      .toEqual(expect.arrayContaining([
        live.find(entry => entry.word === (action === 'Delete' ? deleted : '甲词')),
        { word: approved.word, weight: safeWeight },
      ]))
  })

  it('rejects a changed live chain and rolls back the content claim', async () => {
    const { batchId, current, apply } = await setup()
    await prisma.phrase.update({ where: { id: current.id }, data: { weight: 106 } })
    const before = await storedBatch(batchId)
    const response = await apply()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '编码链已变化，请重新复审' })
    expect(await storedBatch(batchId)).toEqual(before)
  })

  it('rejects a stale version without updating any rows', async () => {
    const { batchId, version, apply } = await setup()
    const before = await storedBatch(batchId)
    expect((await apply(undefined, version - 1)).status).toBe(409)
    expect(await storedBatch(batchId)).toEqual(before)
  })

  it('rejects a signed-in user without an admin role', async () => {
    const { batchId, author, apply } = await setup()
    vi.mocked(getSession).mockResolvedValue({ id: author.id, name: author.name! })
    const before = await storedBatch(batchId)
    expect((await apply()).status).toBe(403)
    expect(await storedBatch(batchId)).toEqual(before)
  })
})
