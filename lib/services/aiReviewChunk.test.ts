import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/admin/batches/[id]/ai-review/route'
import { POST as autoReview } from '@/app/api/bot/batches/[id]/auto-review/route'
import { getAdminBatchReviewDetail } from './adminBatchReviewDetailService'
import { chunkAiReviewTargets } from './aiReviewChunks'
import { computeReviewDigest, formatMiaomiaoReviewRemark } from './batchBotReviewService'
import { parseMiaomiaoReviewRemark } from './miaomiaoReviewRemark'

const { tx, checkConflicts, buildContext } = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    batch: { findUnique: vi.fn(), updateMany: vi.fn() },
    pullRequest: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  checkConflicts: vi.fn(),
  buildContext: vi.fn(),
}))

vi.mock('@/lib/adminAuth', () => ({
  checkAdminPermission: async () => ({ authorized: true }),
}))
vi.mock('@/lib/botAuth', () => ({ verifyBotToken: async () => true }))
vi.mock('@/lib/prisma', () => ({
  prisma: { ...tx, $transaction: (work: (client: typeof tx) => Promise<void>) => work(tx) },
}))
vi.mock('./batchConflictService', () => ({ checkBatchConflictsWithWeight: checkConflicts }))
vi.mock('./batchAiReviewService', () => ({ buildMiaomiaoItemReviewContext: buildContext }))

const generatedAt = '2026-11-25T00:00:00.000Z'
const fetchMock = vi.fn<typeof fetch>()

function row(id: number) {
  return {
    id, action: 'Create' as const, word: '安波', oldWord: null, code: 'xfbl', type: 'Phrase' as const,
    weight: null as number | null, remark: null as string | null, status: 'Pending' as const,
    appliedAt: null as Date | null, dependencies: [],
  }
}

function verdict(prId: number) {
  return { prId, status: 'attention' as const, severity: 'warning' as const, title: '待看', reasons: [], suggestions: [] }
}

function setBatch(rows: ReturnType<typeof row>[]) {
  tx.batch.findUnique.mockResolvedValue({ id: 'batch', status: 'Submitted', contentVersion: 4, pullRequests: rows })
  tx.pullRequest.findMany.mockImplementation(async ({ where }) =>
    rows.filter(pr => where.id.in.includes(pr.id)))
}

function postRaw(body?: string) {
  return POST(new NextRequest('http://localhost/api/admin/batches/batch/ai-review', {
    method: 'POST',
    body,
  }), { params: Promise.resolve({ id: 'batch' }) })
}

function post(body?: unknown) {
  return postRaw(JSON.stringify(body))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('MIAOMIAO_REVIEW_TARGET_IDS', undefined)
  checkConflicts.mockResolvedValue([])
  buildContext.mockResolvedValue({ items: [], codeChains: [] })
  tx.$queryRaw.mockResolvedValue([{ status: 'Submitted', itemReviewStarted: false }])
  tx.batch.updateMany.mockResolvedValue({ count: 1 })
  tx.pullRequest.updateMany.mockResolvedValue({ count: 1 })
  setBatch([row(1), row(2), { ...row(3), appliedAt: new Date(generatedAt) }])
  fetchMock.mockImplementation(async (_url, init) => {
    const { batch } = JSON.parse(String(init?.body))
    return Response.json({
      aiReview: { generatedAt, items: batch.pullRequests.map((pr: { id: number }) => verdict(pr.id)) },
    })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('grouping AI review targets by slot', () => {
  it('keeps a slot together across the 12-item boundary and separates different types', () => {
    const firstTargets = Array.from({ length: 11 }, (_, index) => ({ id: index + 1, code: `slot${index}` }))
    const targets = [
      ...firstTargets,
      { id: 12, code: 'ABCD' },
      { id: 13, code: 'abcd', type: 'Simple' },
      { id: 14, code: null, phrase: { code: 'abcd' }, type: 'Phrase' },
    ]

    expect(chunkAiReviewTargets(targets)).toEqual([firstTargets.map(target => target.id), [12, 14, 13]])
  })

  it('splits a slot above the request limit into consecutive chunks', () => {
    const targets = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, code: 'abcd' }))

    expect(chunkAiReviewTargets(targets)).toEqual([targets.slice(0, 12).map(target => target.id), [13]])
  })
})

describe('Miaomiao review requests', () => {
  it.each([
    ['admin', '0', undefined, 290_000],
    ['admin', '1', 280_000, 290_000],
    ['bot', '0', undefined, 290_000],
    ['bot', '1', 170_000, 180_000],
  ])('uses the %s review timeout with rollout flag %s', async (caller, flag, deadline, timeout) => {
    vi.stubEnv('MIAOMIAO_REVIEW_TARGET_IDS', flag)
    const setTimer = vi.spyOn(globalThis, 'setTimeout')
    const response = caller === 'admin' ? await post({ prIds: [1] }) : await autoReview(
      new NextRequest('http://localhost/api/bot/batches/batch/auto-review', {
        method: 'POST', body: JSON.stringify({ prIds: [1] }),
      }),
      { params: Promise.resolve({ id: 'batch' }) },
    )

    expect(response?.status).toBe(200)
    const sent = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))
    expect(sent.focus_pr_id).toBe(1)
    expect(sent.batch.pullRequests.map((pr: { id: number }) => pr.id)).toEqual([1, 2])
    if (deadline !== undefined) {
      expect(sent).toMatchObject({ target_pr_ids: [1], deadline_ms: deadline })
    } else {
      expect(sent).not.toHaveProperty('target_pr_ids')
      expect(sent).not.toHaveProperty('deadline_ms')
    }
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), timeout)
    expect(checkConflicts).toHaveBeenCalledOnce()
  })

  it('includes every unapplied target for a whole-batch admin request with the flag on', async () => {
    vi.stubEnv('MIAOMIAO_REVIEW_TARGET_IDS', '1')
    expect((await post())?.status).toBe(200)
    const sent = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))
    expect(sent).toMatchObject({ target_pr_ids: [1, 2], deadline_ms: 280_000 })
    expect(sent).not.toHaveProperty('focus_pr_id')
  })
})

describe('admin review freshness', () => {
  it('compares the last digest with raw content and weight', async () => {
    const raw = row(1)
    const item = verdict(raw.id)
    const remark = formatMiaomiaoReviewRemark(item, generatedAt, computeReviewDigest(raw))
    setBatch([
      { ...raw, remark },
      { ...raw, id: 2, remark, code: 'xfba' },
      { ...raw, id: 3, remark: formatMiaomiaoReviewRemark(item, generatedAt) },
      { ...raw, id: 4, remark: formatMiaomiaoReviewRemark(item, generatedAt, computeReviewDigest({ ...raw, weight: 100 })) },
    ])
    checkConflicts.mockResolvedValue([1, 2, 3, 4].map(id => ({
      id: String(id), calculatedWeight: 100, conflict: { hasConflict: false },
    })))

    const detail = await getAdminBatchReviewDetail('batch')

    expect(detail?.pullRequests.map(({ weight, reviewFresh }) => [weight, reviewFresh]))
      .toEqual([[100, true], [100, false], [100, false], [100, false]])
    expect(tx.pullRequest.findMany).not.toHaveBeenCalled()
  })
})

describe('admin AI review chunks', () => {
  it.each([
    { prIds: [] },
    { prIds: [0] },
    { prIds: [1.5] },
    { prIds: ['1'] },
    { prIds: [1, 1] },
    { prIds: Array.from({ length: 13 }, (_, i) => i + 1) },
    { prId: 1, prIds: [2] },
  ])('rejects invalid chunk IDs: %j', async body => {
    expect((await post(body))?.status).toBe(400)
    expect(tx.batch.findUnique).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([3, 999])('rejects a chunk containing applied or foreign ID %i', async id => {
    expect((await post({ prIds: [1, id] }))?.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tx.pullRequest.updateMany).not.toHaveBeenCalled()
  })

  it('does not run a whole-batch review for malformed JSON', async () => {
    expect((await postRaw('{"prIds":'))?.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends all target slots before up to 48 closure neighbours and writes only the targets', async () => {
    const codes = ['abc', 'def', 'ghi']
    const sameSlot = Array.from({ length: 51 }, (_, i) => ({
      ...row(i + 1), word: `Slot item ${i}`, code: codes[i % codes.length],
    }))
    const neighbours = Array.from({ length: 75 }, (_, i) => ({
      ...row(i + 52), word: `Neighbour ${i}`, code: `${codes[i % codes.length]}${i}`,
    }))
    const applied = { ...sameSlot[0], id: 127, appliedAt: new Date(generatedAt) }
    const rows = [...neighbours, ...sameSlot, applied]
    setBatch(rows)
    const targets = [51, 1, 2, 4]

    const response = await post({ prIds: targets })

    expect(response?.status).toBe(200)
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    const contextIds: number[] = sent.batch.pullRequests.map((pr: { id: number }) => pr.id)
    expect(contextIds).toHaveLength(sameSlot.length + 48)
    expect(new Set(contextIds).size).toBe(contextIds.length)
    expect(contextIds.slice(0, sameSlot.length)).toEqual([
      ...targets, ...sameSlot.map(pr => pr.id).filter(id => !targets.includes(id)),
    ])
    expect(contextIds).not.toContain(applied.id)
    const builtIds = buildContext.mock.lastCall?.[0].map((pr: { id: number }) => pr.id)
    expect(builtIds).toEqual(rows.map(pr => pr.id).filter(id => contextIds.includes(id)))
    expect(sent).not.toHaveProperty('focus_pr_id')
    expect(tx.pullRequest.updateMany.mock.calls.map(([arg]) => arg.where.id).sort((a, b) => a - b))
      .toEqual([...targets].sort((a, b) => a - b))
  })

  it('forwards a warning and persists a fallback item without a digest', async () => {
    const marker = {
      reviewedBy: 'Miaomiao', source: 'bot-llm-fallback', summary: '待看', sources: [], evidence: [],
    }
    fetchMock.mockResolvedValueOnce(Response.json({
      warning: '复审输出异常', aiReview: { generatedAt, items: [{ ...verdict(1), reviewRecord: marker }] },
    }))

    const response = await post({ prIds: [1] })

    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({ reviewedAt: generatedAt, warning: '复审输出异常' })
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(sent.focus_pr_id).toBe(1)
    const remark = tx.pullRequest.updateMany.mock.lastCall?.[0].data.remark
    expect(parseMiaomiaoReviewRemark(remark).review?.status).toBe('需复核')
    expect(remark).not.toContain('校验：')
  })

  it('does not write any item when the bot omits a target', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ aiReview: { generatedAt, items: [verdict(1)] } }))

    expect((await post({ prIds: [1, 2] }))?.status).toBe(502)
    expect(tx.batch.updateMany).not.toHaveBeenCalled()
    expect(tx.pullRequest.updateMany).not.toHaveBeenCalled()
  })

  it('keeps an earlier chunk saved when a later chunk becomes stale', async () => {
    expect((await post({ prIds: [1] }))?.status).toBe(200)
    tx.batch.updateMany.mockResolvedValueOnce({ count: 0 })

    expect((await post({ prIds: [2] }))?.status).toBe(409)
    expect(tx.pullRequest.updateMany.mock.calls.map(([arg]) => arg.where.id)).toEqual([1])
  })

  it.each([undefined, '', '{}'])('keeps the legacy whole-batch request working: %j', async body => {
    const response = await postRaw(body)

    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({ reviewedAt: generatedAt })
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(sent).not.toHaveProperty('focus_pr_id')
    expect(sent.batch.pullRequests.map((pr: { id: number }) => pr.id)).toEqual([1, 2])
    expect(tx.pullRequest.updateMany).toHaveBeenCalledTimes(2)
  })
})
