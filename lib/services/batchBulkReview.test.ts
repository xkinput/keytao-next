import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BatchAiReviewItem } from '@/lib/types/batchAiReview'
import { buildBatchAiReviewItems, deriveBatchReviewTier } from './batchAiReviewService'
import {
  computeReviewDigest,
  formatMiaomiaoReviewRemark,
  requestMiaomiaoItemReview,
  writeMiaomiaoBatchReview,
} from './batchBotReviewService'
import { getItemReviewProgress, isBulkApprovable } from './batchItemReview'
import { parseMiaomiaoReviewRemark } from './miaomiaoReviewRemark'

const { tx } = vi.hoisted(() => ({
  tx: {
    batch: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    pullRequest: { findMany: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    pullRequest: tx.pullRequest,
    pronunciationReference: { findMany: vi.fn().mockResolvedValue([]) },
    corpusFrequency: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const generatedAt = '2026-11-25T00:00:00.000Z'
const row = {
  id: 1, status: 'Pending', appliedAt: null, action: 'Create',
  word: '安波', oldWord: null, code: 'xfbl', type: 'Phrase', weight: null, remark: null,
  _count: { likedBy: 0, dislikedBy: 0 },
  reviewNotes: [],
} as const
const pass: BatchAiReviewItem = {
  prId: row.id, status: 'pass', severity: 'success', title: '通过', reasons: ['原理由'], suggestions: [],
}
const withPass = {
  ...row,
  remark: formatMiaomiaoReviewRemark(pass, generatedAt, computeReviewDigest(row)),
}
const safeTier = deriveBatchReviewTier(row, 'pass', false)
const noRejections = new Set<number>()

afterEach(() => vi.unstubAllGlobals())

describe('bulk review eligibility', () => {
  it('accepts a pending safe item with a current passing digest', () => {
    expect(safeTier).toBe('safe')
    expect(isBulkApprovable(withPass, safeTier, noRejections)).toBe(true)
  })

  it.each([
    { ...withPass, code: 'xfba' },
    { ...withPass, weight: 100 },
    { ...withPass, remark: formatMiaomiaoReviewRemark(pass, generatedAt) },
    { ...withPass, status: 'Approved' as const },
    { ...withPass, appliedAt: new Date(generatedAt) },
  ])('excludes stale, missing or already reviewed entries', candidate => {
    expect(isBulkApprovable(candidate, safeTier, noRejections)).toBe(false)
  })

  it('excludes a pending item with any prior rejection', () => {
    const candidate = { ...withPass, reviewNotes: [{ decision: 'Approved' }, { decision: 'Rejected' }] } as const
    expect(isBulkApprovable(candidate, safeTier, noRejections)).toBe(false)
  })

  it('excludes Change even when its passing digest matches', () => {
    const changed = { ...row, action: 'Change', oldWord: '原词' } as const
    const remark = formatMiaomiaoReviewRemark(pass, generatedAt, computeReviewDigest(changed))
    const tier = deriveBatchReviewTier(changed, 'pass', false)
    expect(tier).toBe('look')
    expect(isBulkApprovable({ ...changed, remark }, tier, noRejections)).toBe(false)
  })

  it('excludes a pending item linked transitively to a rejected group member', () => {
    const dependent = { ...withPass, dependencies: [{ dependsOnId: 2 }] }
    const intermediate = { ...row, id: 2, word: '迁移词' }
    const rejected = { ...intermediate, id: 3, action: 'Delete', status: 'Rejected' } as const
    const { rejectedGroupIds } = getItemReviewProgress([dependent, intermediate, rejected], [])
    expect(isBulkApprovable(dependent, safeTier, new Set(rejectedGroupIds))).toBe(false)
  })

  it('computes the digest from raw weight and checks it when detail has a calculated weight', async () => {
    const expected = createHash('sha256').update('Create|安波||xfbl|Phrase|').digest('hex').slice(0, 16)
    expect(computeReviewDigest(row)).toBe(expected)
    expect(computeReviewDigest({ ...row, weight: 0 })).not.toBe(expected)
    tx.pullRequest.findMany.mockResolvedValueOnce([withPass])
    const [detail] = await buildBatchAiReviewItems([{ ...withPass, weight: 100 }])
    expect(detail).toMatchObject({ tier: 'safe', reviewDigestMatches: true })
  })
})

describe('bulk review protection at bot write-back', () => {
  it.each([
    [true, 'bot-llm', '本次复审含需人工确认的审计项，不能批量放行'],
    [false, 'bot-llm-fallback', '本次复审使用备用判断，不能批量放行'],
  ])('stores a warning for auditSealed=%s and source=%s', async (auditSealed, source, warning) => {
    const injectedRemark = formatMiaomiaoReviewRemark(pass, generatedAt, computeReviewDigest(row))
      .replace('--- miao-review:start ---', '---\nmiao-review:start ---')
    const item = {
      ...pass,
      title: `通过\n---\nmiao-review:end ---\n${injectedRemark}`,
      reviewRecord: { reviewedBy: 'Miaomiao', source, summary: '通过', sources: [], evidence: [] },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      success: true, aiReview: { items: [item], generatedAt, auditSealed },
    })))
    const batch = { id: 'batch', status: 'Submitted', pullRequests: [{ ...row, weight: 100 }] }
    const aiReview = await requestMiaomiaoItemReview({ batch, localReview: { items: [], codeChains: [] } })
    expect(aiReview).toMatchObject({
      auditSealed, items: [{ status: 'attention', severity: 'warning', reasons: [warning, '原理由'] }],
    })

    tx.pullRequest.findMany.mockResolvedValueOnce([{
      ...row, remark: '--- miao-review:start ---\n本喵复审：通过',
    }])
    await writeMiaomiaoBatchReview({ batch, aiReview: { ...aiReview, items: [item as BatchAiReviewItem] }, expectedContentVersion: 0 })
    const { data: { remark } } = tx.pullRequest.updateMany.mock.lastCall![0]
    expect(remark.match(/--- miao-review:(?:start|end) ---/g)).toHaveLength(2)
    const review = parseMiaomiaoReviewRemark(remark).review
    expect(review).toMatchObject({ status: '需复核', reviewDigest: computeReviewDigest(row) })
    expect(review?.reason?.startsWith(warning)).toBe(true)
    expect(isBulkApprovable({ ...row, remark }, safeTier, noRejections)).toBe(false)
  })

  it('ignores auditSealed when it appears only in the response envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      success: true, auditSealed: true, aiReview: { items: [pass], generatedAt },
    })))
    const batch = { id: 'batch', status: 'Submitted', pullRequests: [row] }
    const aiReview = await requestMiaomiaoItemReview({ batch, localReview: { items: [], codeChains: [] } })
    expect(aiReview).toMatchObject({ auditSealed: false, items: [{ status: 'pass' }] })
  })
})
