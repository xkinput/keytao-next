import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUT } from '@/app/api/batches/[id]/pull-requests/route'
import { GET } from '@/app/api/bot/auto-review/queue/route'
import { POST } from '@/app/api/bot/batches/[id]/auto-review/route'
import { PATCH } from '@/app/api/pull-requests/[id]/route'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createTestBatch, createTestUser } from '@/lib/test/helpers'
import type { BatchAiReviewItem } from '@/lib/types/batchAiReview'
import { approveSubmittedBatch } from '../batchApprovalService'
import { computeReviewDigest, formatMiaomiaoReviewRemark, writeMiaomiaoItemReviewsByDigest } from '../batchBotReviewService'
import { parseMiaomiaoReviewRemark } from '../miaomiaoReviewRemark'

vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSession: vi.fn(),
}))

const token = 'test-auto-review-token'
const generatedAt = '2026-11-25T00:00:00.000Z'
const proposal = { action: 'Create', word: '自动复审', code: 'zdre', type: 'Phrase', weight: 110 } as const
const fetchMock = vi.fn<typeof fetch>()

function verdict(prId: number): BatchAiReviewItem {
  return { prId, status: 'pass', severity: 'success', title: '已复审', reasons: [], suggestions: [] }
}

function reviewFor(...ids: number[]) {
  return { generatedAt, items: ids.map(verdict) }
}

function queue(limit = 12) {
  return GET(new NextRequest(`http://localhost/api/bot/auto-review/queue?limit=${limit}`))
}

function post(batchId: string, prIds: number[]) {
  return POST(new NextRequest(`http://localhost/api/bot/batches/${batchId}/auto-review`, {
    method: 'POST', body: JSON.stringify({ prIds }),
  }), { params: Promise.resolve({ id: batchId }) })
}

function saveBatch(batchId: string, expectedContentVersion: number, item: object) {
  return PUT(new NextRequest(`http://localhost/api/batches/${batchId}/pull-requests`, {
    method: 'PUT', body: JSON.stringify({ expectedContentVersion, items: [item] }),
  }), { params: Promise.resolve({ id: batchId }) })
}

async function authorDraft() {
  const author = await createTestUser()
  vi.mocked(getSession).mockResolvedValue({ id: author.id, name: author.name! })
  const { batch, prs: [pr] } = await createTestBatch(author.id, [proposal])
  return { author, batch, pr }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BOT_API_TOKEN', token)
  vi.mocked(headers).mockResolvedValue(new Headers({ 'x-bot-token': token }))
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (_url, init) => {
    const { batch } = JSON.parse(String(init?.body))
    return Response.json({ aiReview: reviewFor(...batch.pullRequests.map((pr: { id: number }) => pr.id)) })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Miaomiao automatic item review', () => {
  it('selects the oldest eligible batch and queues only quiet, unapplied, missing or stale reviews', async () => {
    const author = await createTestUser()
    const old = new Date(Date.now() - 120_000)
    const earlier = new Date(old.getTime() - 10_000)
    const later = new Date(old.getTime() + 10_000)
    const { batch, prs: [missing, stale, fresh, quiet, applied] } = await createTestBatch(author.id, [
      { ...proposal, weight: undefined }, { ...proposal, word: '词条已改' }, { ...proposal, word: '已复审' },
      { ...proposal, word: '刚保存' }, { ...proposal, word: '已应用' },
    ])
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Rejected' } })
    await prisma.pullRequest.updateMany({
      where: { id: { in: [missing.id, stale.id, fresh.id, applied.id] } },
      data: { createAt: old, updateAt: old },
    })
    const staleTime = new Date(old.getTime() - 7 * 60 * 60 * 1000).toISOString()
    const staleRemark = formatMiaomiaoReviewRemark(verdict(stale.id), staleTime, computeReviewDigest({ ...stale, word: '旧词' }))
    const freshRemark = formatMiaomiaoReviewRemark(verdict(fresh.id), generatedAt, computeReviewDigest(fresh))
    await prisma.pullRequest.update({ where: { id: stale.id }, data: { updateAt: old, remark: staleRemark } })
    await prisma.pullRequest.update({ where: { id: fresh.id }, data: {
      updateAt: old, remark: `${staleRemark}\n\n${freshRemark}`,
    } })
    await prisma.pullRequest.update({ where: { id: quiet.id }, data: { createAt: earlier } })
    await prisma.pullRequest.update({ where: { id: applied.id }, data: { appliedAt: old, createAt: earlier, updateAt: old } })

    const blocked = [
      { status: 'Submitted', itemReviewStarted: true },
      { status: 'Approved', itemReviewStarted: false },
    ] as const
    for (const data of blocked) {
      const fixture = await createTestBatch(author.id, [proposal])
      await prisma.batch.update({ where: { id: fixture.batch.id }, data })
      await prisma.pullRequest.update({ where: { id: fixture.prs[0].id }, data: { createAt: earlier, updateAt: old } })
    }
    const eligibleSubmitted = await createTestBatch(author.id, [proposal])
    await prisma.batch.update({ where: { id: eligibleSubmitted.batch.id }, data: { status: 'Submitted' } })
    await prisma.pullRequest.update({
      where: { id: eligibleSubmitted.prs[0].id }, data: { createAt: later, updateAt: old },
    })
    const items = [missing, stale].map(pr => ({ prId: pr.id, digest: computeReviewDigest(pr) }))

    expect(await (await queue()).json()).toEqual({ success: true, batchId: batch.id, items })
    expect(await (await queue(1)).json()).toEqual({ success: true, batchId: batch.id, items: items.slice(0, 1) })
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Approved' } })
    expect(await (await queue()).json()).toEqual({
      success: true, batchId: eligibleSubmitted.batch.id,
      items: [{ prId: eligibleSubmitted.prs[0].id, digest: computeReviewDigest(eligibleSubmitted.prs[0]) }],
    })
  })

  it('filters already fresh rows before limiting the candidate scan', async () => {
    const { author, batch, pr } = await authorDraft()
    const quiet = new Date(Date.now() - 100_000)
    const earlier = new Date(quiet.getTime() - 10_000)
    const remark = formatMiaomiaoReviewRemark(verdict(pr.id), generatedAt, computeReviewDigest(pr))
    await prisma.pullRequest.update({ where: { id: pr.id }, data: { updateAt: quiet } })
    await prisma.pullRequest.createMany({ data: Array.from({ length: 201 }, () => ({
      ...proposal, batchId: batch.id, userId: author.id, remark, createAt: earlier, updateAt: quiet,
    })) })

    expect(await (await queue()).json()).toEqual({
      success: true, batchId: batch.id, items: [{ prId: pr.id, digest: computeReviewDigest(pr) }],
    })
  })

  it('writes the raw digest without changing contentVersion or votes', async () => {
    const { author, batch, pr } = await authorDraft()
    const voter = await createTestUser()
    const row = await prisma.pullRequest.update({ where: { id: pr.id }, data: {
      weight: null, remark: '作者备注', likedBy: { connect: { id: author.id } }, dislikedBy: { connect: { id: voter.id } },
    } })

    const response = await post(batch.id, [pr.id])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, reviewed: [pr.id], skipped: [] })
    const stored = await prisma.pullRequest.findUniqueOrThrow({
      where: { id: pr.id },
      include: { batch: true, _count: { select: { likedBy: true, dislikedBy: true } } },
    })
    expect(stored.batch?.contentVersion).toBe(batch.contentVersion)
    expect(stored._count).toEqual({ likedBy: 1, dislikedBy: 1 })
    expect(parseMiaomiaoReviewRemark(stored.remark)).toMatchObject({
      baseRemark: '作者备注', review: { reviewDigest: computeReviewDigest(row) },
    })
  })

  it('writes an undigested fallback for a missing result and cools it down without blocking later batches', async () => {
    const { author, batch, pr } = await authorDraft()
    const next = await createTestBatch(author.id, [proposal])
    const nextPr = next.prs[0]
    const now = Date.now()
    const oldest = new Date(now - 120_000)
    const newer = new Date(now - 100_000)
    const recentReview = new Date(now - 60 * 60 * 1000).toISOString()
    const expiredReview = new Date(now - 7 * 60 * 60 * 1000).toISOString()
    const authorRemark = '作者备注'
    await prisma.pullRequest.update({ where: { id: pr.id }, data: {
      remark: authorRemark, createAt: oldest, updateAt: oldest,
    } })
    await prisma.pullRequest.update({ where: { id: nextPr.id }, data: { createAt: newer, updateAt: newer } })
    const first = { success: true, batchId: batch.id, items: [{ prId: pr.id, digest: computeReviewDigest(pr) }] }
    expect(await (await queue()).json()).toEqual(first)

    fetchMock.mockResolvedValueOnce(Response.json({ aiReview: { generatedAt: recentReview, items: [] } }))
    expect(await (await post(batch.id, [pr.id])).json()).toEqual({ success: true, reviewed: [pr.id], skipped: [] })
    const { remark } = await prisma.pullRequest.update({ where: { id: pr.id }, data: { updateAt: oldest } })
    expect(remark).not.toContain('校验：')
    expect(parseMiaomiaoReviewRemark(remark)).toMatchObject({ baseRemark: authorRemark, review: {
      status: '需复核', reason: '喵喵未返回该词条的结果', generatedAt: recentReview, reviewDigest: undefined,
    } })

    await prisma.pullRequest.createMany({ data: Array.from({ length: 200 }, () => ({
      ...proposal, batchId: batch.id, userId: author.id, remark, createAt: oldest, updateAt: oldest,
    })) })
    expect(await (await queue()).json()).toEqual({
      success: true, batchId: next.batch.id, items: [{ prId: nextPr.id, digest: computeReviewDigest(nextPr) }],
    })

    await prisma.pullRequest.update({ where: { id: pr.id }, data: {
      remark: remark!.replace(`时间：${recentReview}`, `时间：${expiredReview}`), updateAt: oldest,
    } })
    expect(await (await queue()).json()).toEqual(first)
  })

  it('skips a result after the author edits the target while the model runs', async () => {
    const { batch, pr } = await authorDraft()
    const word = '作者改词'
    fetchMock.mockImplementationOnce(async () => {
      const response = await saveBatch(batch.id, batch.contentVersion, { ...proposal, id: pr.id, word })
      expect(response.status).toBe(200)
      return Response.json({ aiReview: reviewFor(pr.id) })
    })

    expect(await (await post(batch.id, [pr.id])).json()).toEqual({ success: true, reviewed: [], skipped: [pr.id] })
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).toMatchObject({ word, remark: null })
  })

  it('skips a result when Submitted item review starts while the model runs', async () => {
    const { batch, pr } = await authorDraft()
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
    fetchMock.mockImplementationOnce(async () => {
      await prisma.batch.update({ where: { id: batch.id }, data: { itemReviewStarted: true } })
      return Response.json({ aiReview: reviewFor(pr.id) })
    })

    expect(await (await post(batch.id, [pr.id])).json()).toEqual({ success: true, reviewed: [], skipped: [pr.id] })
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).toMatchObject({ remark: null })
  })

  it('skips a target whose remark changes after the transactional read', async () => {
    const { batch, pr } = await authorDraft()
    const remark = '并发备注'
    const instrumented = prisma.$extends({ query: { pullRequest: {
      async updateMany({ args, query }) {
        await prisma.pullRequest.update({ where: { id: pr.id }, data: { remark } })
        return query(args)
      },
    } } })
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(work =>
      instrumented.$transaction(tx => work(tx as unknown as Prisma.TransactionClient)),
    )

    await expect(writeMiaomiaoItemReviewsByDigest({
      batchId: batch.id, targetDigests: new Map([[pr.id, computeReviewDigest(pr)]]), aiReview: reviewFor(pr.id),
    })).resolves.toEqual({ reviewed: [], skipped: [pr.id] })
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).toMatchObject({ remark })
  })

  it('keeps the review on a same-version author PUT and drops it after a content edit', async () => {
    const { batch, pr } = await authorDraft()
    expect((await post(batch.id, [pr.id])).status).toBe(200)
    const previous = await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })
    const remark = '备'.repeat(500)
    const item = { ...proposal, id: pr.id, remark }

    const saved = await saveBatch(batch.id, batch.contentVersion, item)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ contentVersion: batch.contentVersion + 1 })
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).toMatchObject({
      remark: `${remark}\n\n${previous.remark}`,
    })

    const edited = await saveBatch(batch.id, batch.contentVersion + 1, { ...item, word: '作者改词' })
    expect(edited.status).toBe(200)
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).toMatchObject({ remark })
  })

  it('preserves the review on a remark-only PATCH and drops it on content change without a remark', async () => {
    const { batch, pr } = await authorDraft()
    expect((await post(batch.id, [pr.id])).status).toBe(200)
    const patch = (body: object) => PATCH(new NextRequest(`http://localhost/api/pull-requests/${pr.id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: String(pr.id) }) })

    const saved = await patch({ ...proposal, remark: '作者后记', expectedContentVersion: batch.contentVersion })
    expect(saved.status).toBe(200)
    expect(parseMiaomiaoReviewRemark((await saved.json()).pullRequest.remark)).toMatchObject({
      baseRemark: '作者后记', review: { reviewDigest: computeReviewDigest(pr) },
    })
    const edited = await patch({ ...proposal, word: '作者改词', expectedContentVersion: batch.contentVersion + 1 })
    expect(edited.status).toBe(200)
    expect((await edited.json()).pullRequest.remark).toBe('作者后记')
  })

  it('keeps only the author remark when approval creates or changes a live phrase', async () => {
    const author = await createTestUser()
    const target = await prisma.phrase.create({ data: {
      word: '原词条', code: 'yctu', type: 'Phrase', weight: 100, status: 'Finish', userId: author.id, remark: '旧备注',
    } })
    const { batch, prs } = await createTestBatch(author.id, [proposal, {
      action: 'Change', word: '改后词', oldWord: target.word, code: target.code, type: target.type, phraseId: target.id,
    }])
    const authorRemark = '作者备注'
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
    for (const pr of prs) {
      const block = formatMiaomiaoReviewRemark(verdict(pr.id), generatedAt, computeReviewDigest(pr))
      await prisma.pullRequest.update({ where: { id: pr.id }, data: { status: 'Approved', remark: `${authorRemark}\n\n${block}` } })
    }

    await expect(approveSubmittedBatch({ batchId: batch.id })).resolves.toMatchObject({ batch: { status: 'Approved' } })
    expect(await prisma.phrase.findFirstOrThrow({ where: { word: proposal.word, code: proposal.code, type: proposal.type } }))
      .toMatchObject({ status: 'Finish', remark: authorRemark })
    expect(await prisma.phrase.findUniqueOrThrow({ where: { id: target.id } }))
      .toMatchObject({ word: '改后词', status: 'Finish', remark: authorRemark })
  })

  it('requires bot auth for the queue and write route', async () => {
    vi.mocked(headers).mockResolvedValue(new Headers())
    expect((await queue()).status).toBe(401)
    expect((await post('missing', [1])).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing batch and 409 for an approved batch', async () => {
    const { batch, pr } = await authorDraft()
    expect((await post('missing', [pr.id])).status).toBe(404)
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Approved' } })
    expect((await post(batch.id, [pr.id])).status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['http', 'model'])('returns 429 for a %s rate limit without saving a remark', async source => {
    const { batch, pr } = await authorDraft()
    fetchMock.mockResolvedValueOnce(source === 'http'
      ? new Response(null, { status: 429 })
      : Response.json({ warning: 'model Error code: 429', aiReview: reviewFor(pr.id) }))
    const response = await post(batch.id, [pr.id])
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ rateLimited: true })
    expect(await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).toMatchObject({ remark: null })
  })
})
