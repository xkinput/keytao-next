import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/admin/batches/[id]/ai-review/route'
import { prisma } from '@/lib/prisma'
import { createTestBatch, createTestUser } from '@/lib/test/helpers'
import type { BatchAiReviewCodeChain, BatchAiReviewItem } from '@/lib/types/batchAiReview'
import { getAdminBatchReviewDetail } from '../adminBatchReviewDetailService'
import { computeChainDigest } from '../batchAiReviewService'

vi.mock('@/lib/adminAuth', () => ({
  checkAdminPermission: async () => ({ authorized: true }),
}))

const type = 'Phrase' as const
const generatedAt = '2026-11-25T00:00:00.000Z'
const scenarios = [
  { name: 'S1: same slot and unrelated items', code: 'abcd', live: 2, unrelated: 5, prefixes: 0 },
  { name: 'S2: same-slot peer beyond the prefix fill and first chunk', code: 'abcd', live: 2, unrelated: 5, prefixes: 30 },
  { name: 'S3: two-letter slot', code: 'ab', live: 1, unrelated: 0, prefixes: 0 },
]

afterEach(() => vi.unstubAllGlobals())

describe.each(['prId', 'prIds'] as const)('AI review chain digest in PostgreSQL (%s)', mode => {
  it.each(scenarios)('$name', async ({ code, live, unrelated, prefixes }) => {
    const author = await createTestUser()
    await prisma.phrase.createMany({
      data: ['现有甲', '现有乙'].slice(0, live).map((word, i) => ({
        word, code, type, weight: 110 + i, status: 'Finish', userId: author.id,
      })),
    })
    const { batch, prs } = await createTestBatch(author.id, [
      { action: 'Create', word: '新增甲', code, type },
      // Keep every prefix target in the first chunk connected to the crowded prefix neighbourhood.
      ...Array.from({ length: prefixes }, (_, i) => ({
        action: 'Create' as const, word: `前缀词${i}`, type,
        code: i < 11 ? 'abcde' : `abcde${String.fromCharCode(97 + i - 11)}`,
      })),
      ...Array.from({ length: unrelated }, (_, i) => ({
        action: 'Create' as const, word: `无关词${i}`, code: 'zyxw', type,
      })),
      { action: 'Create', word: '新增乙', code, type },
    ])
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })

    const target = prs[0]
    const targetIds = mode === 'prId' ? [target.id] : prs.slice(0, -1).slice(0, 12).map(pr => pr.id)
    const body = mode === 'prId' ? { prId: target.id } : { prIds: targetIds }
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as {
        batch: { pullRequests: { id: number }[] }
        local_review: { codeChains: Pick<BatchAiReviewCodeChain, 'code' | 'type' | 'after'>[] }
      }
      const chain = sent.local_review.codeChains.find(chain => chain.code === code && chain.type === type)!
      const orderedWords = [
        ...chain.after.filter(entry => entry.source === 'draft'),
        ...chain.after.filter(entry => entry.source === 'current'),
      ].map(entry => entry.word)
      const suggestedOrder = { code, type, orderedWords, chainDigest: computeChainDigest(chain.after) }
      const items = sent.batch.pullRequests.map(({ id }): BatchAiReviewItem => ({
        prId: id, status: 'attention', severity: 'warning', title: 'Reviewed', reasons: [], suggestions: [],
        ...(id === target.id ? { suggestedOrder } : {}),
      }))
      return Response.json({ aiReview: { generatedAt, items } })
    })

    const response = await POST(new NextRequest(`http://localhost/api/admin/batches/${batch.id}/ai-review`, {
      method: 'POST', body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: batch.id }) })

    expect(response?.status).toBe(200)
    const detail = await getAdminBatchReviewDetail(batch.id)
    expect(detail?.pullRequests.find(pr => pr.id === target.id)).toMatchObject({
      remark: expect.stringContaining('排序：'), suggestedOrderApplicable: true,
    })
    expect(detail?.pullRequests.filter(pr => pr.remark !== null).map(pr => pr.id)).toEqual(targetIds)
  })
})
