import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { GET as getPreview } from '@/app/api/batches/[id]/preview/route'
import { POST } from '@/app/api/batches/[id]/reorder/route'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createTestBatch, createTestUser } from '@/lib/test/helpers'
import { approveSubmittedBatch } from '../batchApprovalService'
import { computeReviewDigest, formatMiaomiaoReviewRemark } from '../batchBotReviewService'
import { checkBatchConflictsWithWeight } from '../batchConflictService'
import { recordItemReview } from '../batchItemReview'
import type { ChainReorderTarget } from '../suggestedOrderService'

vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSession: vi.fn(),
}))

const code = 'pxci'
const type = 'Phrase' as const
const create = { action: 'Create', word: '新候选', code, type, weight: 110 } as const
type TestUser = Awaited<ReturnType<typeof createTestUser>>

function signIn(user: TestUser) {
  vi.mocked(getSession).mockResolvedValue({ id: user.id, name: user.name! })
}

function reorder(batchId: string, movedPrId: number, target: ChainReorderTarget, expectedContentVersion: number) {
  return POST(new NextRequest(`http://localhost/api/batches/${batchId}/reorder`, {
    method: 'POST', body: JSON.stringify({ code, type, movedPrId, ...target, expectedContentVersion }),
  }), { params: Promise.resolve({ id: batchId }) })
}

function createLive(author: TestUser, word: string, weight: number) {
  return prisma.phrase.create({ data: { word, weight, code, type, userId: author.id, status: 'Finish' } })
}

async function draftFixture() {
  const author = await createTestUser()
  signIn(author)
  const live = await createLive(author, '现有候选', 105)
  const { batch, prs: [moved, retained] } = await createTestBatch(author.id, [
    create, { ...create, word: '末位候选', weight: 115 },
  ])
  return { author, live, batch, moved, retained }
}

describe('manual chain reorder', () => {
  it.each(['Draft', 'Rejected'] as const)('allows the owner to reorder a %s batch and increments the version once', async status => {
    const { live, batch, moved, retained } = await draftFixture()
    if (status !== batch.status) await prisma.batch.update({ where: { id: batch.id }, data: { status } })
    const response = await reorder(batch.id, moved.id, { afterWord: live.word }, batch.contentVersion)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      contentVersion: batch.contentVersion + 1, items: [{ id: moved.id, weight: 104, reviewFresh: false }],
    })
    expect(await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({
      contentVersion: batch.contentVersion + 1,
    })
    expect(await prisma.phrase.findUniqueOrThrow({ where: { id: live.id } })).toMatchObject({ weight: 105 })
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: retained.id } })).toMatchObject({ weight: 115 })
    expect((await reorder(batch.id, moved.id, { beforePrId: null }, batch.contentVersion)).status).toBe(409)
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({ weight: 104 })
    expect(await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({
      contentVersion: batch.contentVersion + 1,
    })
  })

  it('requires a session, forbids another author, and rejects attempted live moves and closed batches', async () => {
    const { author, live, batch, moved, retained } = await draftFixture()
    vi.mocked(getSession).mockResolvedValue(null)
    expect((await reorder(batch.id, moved.id, { afterWord: live.word }, batch.contentVersion)).status).toBe(401)
    signIn(await createTestUser())
    expect((await reorder(batch.id, moved.id, { afterWord: live.word }, batch.contentVersion)).status).toBe(403)
    signIn(author)
    // Phrase and pull request IDs come from separate sequences and may overlap.
    let liveId = live.id
    while (liveId === moved.id || liveId === retained.id) {
      liveId = (await createLive(author, `其他现有词${liveId}`, 107 + liveId - live.id)).id
    }
    const response = await reorder(batch.id, liveId, { beforePrId: moved.id }, batch.contentVersion)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '需要移动已上线词条，请改为新增一条修改' })
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Approved' } })
    expect((await reorder(batch.id, moved.id, { afterWord: live.word }, batch.contentVersion)).status).toBe(409)
    expect(await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({ contentVersion: batch.contentVersion })
  })

  it('rejects reordering a Change that duplicates a live word at the same code', async () => {
    const author = await createTestUser()
    signIn(author)
    const anchor = await createLive(author, '现有候选', 105)
    const old = await createLive(author, '旧候选', 125)
    const live = await createLive(author, '新候选', 115)
    const { batch, prs: [change] } = await createTestBatch(author.id, [
      { action: 'Change', oldWord: old.word, word: live.word, code, type, weight: 114 },
    ])
    expect(change.targetPhraseId).toBe(old.id)
    const preview = await getPreview(new NextRequest(`http://localhost/api/batches/${batch.id}/preview`), {
      params: Promise.resolve({ id: batch.id }),
    })
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({ preview: {
      rejected: [{ prId: change.id, oldWord: old.word, word: live.word }], changes: [],
    } })

    const response = await reorder(batch.id, change.id, { afterWord: anchor.word }, batch.contentVersion)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '改词后的「新候选」已在此编码上，请改为删除「旧候选」' })
    expect(await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({ contentVersion: batch.contentVersion })
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: change.id } })).toMatchObject({ weight: 114, targetPhraseId: old.id })
    expect(await prisma.phrase.findUniqueOrThrow({ where: { id: live.id } })).toMatchObject({ weight: 115 })
  })

  it('rolls back when a pending Delete reserves the only weight between live anchors', async () => {
    const author = await createTestUser()
    signIn(author)
    await createLive(author, '前候选', 100)
    const deleted = await createLive(author, '待删候选', 101)
    const anchor = await createLive(author, '后候选', 102)
    const { batch, prs: [moved] } = await createTestBatch(author.id, [
      create, { action: 'Delete', word: deleted.word, code, type },
    ])
    const response = await reorder(batch.id, moved.id, { afterWord: anchor.word }, batch.contentVersion)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '相邻权重没有空位，请先调整相邻词条' })
    expect(await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({ contentVersion: batch.contentVersion })
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({ weight: create.weight })
  })

  it('allows admins during item review, clears stale review and votes, and finalizes after rejecting a Delete', async () => {
    const [author, reviewer] = await Promise.all([createTestUser(), createTestUser()])
    await prisma.user.update({ where: { id: reviewer.id }, data: { roles: { connectOrCreate: {
      where: { value: 'R:MANAGER' }, create: { value: 'R:MANAGER', name: 'Manager' },
    } } } })
    const live = [{ word: '前词', weight: 100 }, { word: '甲词', weight: 102 }, { word: '中词', weight: 103 },
      { word: '乙词', weight: 105 }, { word: '后词', weight: 106 }]
    await prisma.phrase.createMany({ data: live.map(entry => ({ ...entry, code, type, status: 'Finish', userId: author.id })) })
    // Avoid rejecting the Delete linked to the Create by the duplicate-code warning.
    const [probe] = await checkBatchConflictsWithWeight([{ id: '1', ...create }])
    const deleteIndex = probe?.conflict.currentPhrase?.word === live[1].word ? 3 : 1
    const deleted = live[deleteIndex]
    const { batch, prs: [moved, deletion] } = await createTestBatch(author.id, [
      create, { action: 'Delete', word: deleted.word, code, type },
    ])
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
    signIn(author)
    const target = { afterWord: live[deleteIndex + 1].word }
    expect((await reorder(batch.id, moved.id, target, batch.contentVersion)).status).toBe(403)
    signIn(reviewer)
    await recordItemReview({ batchId: batch.id, itemId: deletion.id, reviewerId: reviewer.id, decision: 'Approved',
      reason: 'Reviewed before ordering', expectedContentVersion: batch.contentVersion })
    const { contentVersion: version, itemReviewStarted } = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })
    expect(itemReviewStarted).toBe(true)

    const suggestedOrder = { code, type, orderedWords: [moved.word!, target.afterWord], chainDigest: '0'.repeat(16) }
    for (const item of [moved, deletion]) {
      await prisma.pullRequest.update({ where: { id: item.id }, data: {
        remark: 'Author note\n' + formatMiaomiaoReviewRemark({
          prId: item.id, status: 'pass', severity: 'success', title: 'Reviewed', reasons: [], suggestions: [], suggestedOrder,
        }, '2026-11-25T00:00:00.000Z', computeReviewDigest(item)),
        likedBy: { connect: { id: author.id } }, dislikedBy: { connect: { id: reviewer.id } },
      } })
    }

    const response = await reorder(batch.id, moved.id, target, version)
    expect(response.status).toBe(200)
    const result = await response.json()
    const weight = deleted.weight - 1
    expect(result.contentVersion).toBe(version + 1)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: moved.id, status: 'Pending', weight, reviewFresh: false, _count: { likedBy: 0, dislikedBy: 0 } }),
      expect.objectContaining({ id: deletion.id, reviewFresh: true, _count: { likedBy: 1, dislikedBy: 1 } }),
    ]))
    const changed = result.items.find((item: { id: number }) => item.id === moved.id)
    expect(changed.remark).toContain('Author note')
    expect(changed.remark).not.toMatch(/校验：|排序：/)
    expect(result.items.find((item: { id: number }) => item.id === deletion.id).remark).not.toContain('排序：')

    await recordItemReview({ batchId: batch.id, itemId: deletion.id, reviewerId: reviewer.id, decision: 'Rejected',
      reason: 'Keep the existing entry', expectedContentVersion: result.contentVersion })
    await recordItemReview({ batchId: batch.id, itemId: moved.id, reviewerId: reviewer.id, decision: 'Approved',
      reason: 'Reviewed the new weight', expectedContentVersion: result.contentVersion + 1 })
    await expect(approveSubmittedBatch({ batchId: batch.id, reviewerId: reviewer.id,
      expectedContentVersion: result.contentVersion + 2 })).resolves.toMatchObject({ batch: { status: 'Approved' } })
    expect(await prisma.phrase.findMany({ where: { code, type }, select: { word: true, weight: true } }))
      .toEqual(expect.arrayContaining([deleted, { word: moved.word, weight }]))
  })
})
