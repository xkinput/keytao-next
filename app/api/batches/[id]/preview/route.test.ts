import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
    prisma: {
        batch: {
            findUnique: vi.fn(),
        },
        phrase: {
            findMany: vi.fn(),
            count: vi.fn(),
        },
    },
}))

vi.mock('@/lib/services/batchConflictService', () => ({
    checkBatchConflictsWithWeight: vi.fn(),
}))

const { prisma } = await import('@/lib/prisma')
const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any
const mockCheckBatchConflictsWithWeight = vi.mocked(checkBatchConflictsWithWeight)

const request = new NextRequest('http://localhost/api/batches/batch-1/preview')

function draftChangeBatch() {
    return {
        id: 'batch-1',
        status: 'Draft',
        pullRequests: [
            {
                id: 1550,
                action: 'Change',
                word: '为啥',
                oldWord: '温暖',
                code: 'woi',
                type: 'Phrase',
                weight: null,
                remark: null,
                createAt: new Date('2026-06-03T11:52:20.193Z'),
            },
        ],
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.batch.findUnique.mockResolvedValue(draftChangeBatch())
    mockPrisma.phrase.count.mockResolvedValue(0)
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockCheckBatchConflictsWithWeight.mockResolvedValue([
        {
            id: '1550',
            conflict: {
                hasConflict: false,
                code: 'woi',
                suggestions: [],
            },
        },
    ])
})

describe('GET /api/batches/[id]/preview', () => {
    it('renders a Draft Change operation as a modify diff', async () => {
        mockPrisma.phrase.findMany.mockImplementation((args: { where?: { code?: { in?: string[] } } }) => {
            if (args.where?.code?.in) {
                return Promise.resolve([
                    { word: '温暖', code: 'woi', type: 'Phrase', weight: 100, remark: null },
                ])
            }
            return Promise.resolve([])
        })

        const { GET } = await import('./route')
        const res = await GET(request, { params: Promise.resolve({ id: 'batch-1' }) })
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.preview.summary).toEqual({ added: 0, modified: 1, deleted: 0, rejected: 0 })
        expect(body.preview.changes).toHaveLength(1)
        expect(body.preview.changes[0].diffs).toEqual([
            {
                type: 'modify',
                before: { word: '温暖', code: 'woi', type: 'Phrase', weight: 100 },
                after: { word: '为啥', code: 'woi', type: 'Phrase', weight: 100 },
            },
        ])
        expect(body.preview.changes[0].before.map((p: { word: string }) => p.word)).toContain('温暖')
        expect(body.preview.changes[0].after.map((p: { word: string }) => p.word)).toContain('为啥')
    })

    it('does not silently drop a non-conflicting Draft Change when the old phrase is missing from the preview lookup', async () => {
        const { GET } = await import('./route')
        const res = await GET(request, { params: Promise.resolve({ id: 'batch-1' }) })
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.preview.summary.modified).toBe(1)
        expect(body.preview.summary.added).toBe(0)
        expect(body.preview.summary.deleted).toBe(0)
        expect(body.preview.changes[0].diffs[0]).toMatchObject({
            type: 'modify',
            before: { word: '温暖', code: 'woi', type: 'Phrase' },
            after: { word: '为啥', code: 'woi', type: 'Phrase' },
        })
    })
})
