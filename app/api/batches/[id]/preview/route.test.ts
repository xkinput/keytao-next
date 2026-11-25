import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

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

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(),
}))

vi.mock('@/lib/adminAuth', () => ({
    checkIsAdmin: vi.fn(),
    checkAdminPermission: vi.fn(),
}))

const { prisma } = await import('@/lib/prisma')
const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')
const { getSession } = await import('@/lib/auth')
const { checkAdminPermission, checkIsAdmin } = await import('@/lib/adminAuth')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any
const mockCheckBatchConflictsWithWeight = vi.mocked(checkBatchConflictsWithWeight)
const mockGetSession = vi.mocked(getSession)
const mockCheckIsAdmin = vi.mocked(checkIsAdmin)
const mockCheckAdminPermission = vi.mocked(checkAdminPermission)

const request = new NextRequest('http://localhost/api/batches/batch-1/preview')
const adminRequest = new NextRequest(`${request.url}?review=1`)

function draftChangeBatch() {
    return {
        id: 'batch-1',
        creatorId: 1,
        contentVersion: 7,
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
    mockGetSession.mockResolvedValue({ id: 1, name: 'rea' })
    mockCheckIsAdmin.mockResolvedValue(false)
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
        expect(body.contentVersion).toBe(7)
        expect(body.preview.summary).toEqual({ added: 0, modified: 1, deleted: 0, rejected: 0 })
        expect(body.preview.changes).toHaveLength(1)
        expect(body.preview.changes[0].diffs).toEqual([
            {
                itemId: 1550,
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

    it('checks a same-code Change conflict using the original old word', async () => {
        const batch = draftChangeBatch()
        const [change] = batch.pullRequests
        const live = { code: change.code, type: change.type, status: 'Finish', remark: null }
        mockPrisma.batch.findUnique.mockResolvedValue({ ...batch, pullRequests: [{ ...change, targetPhraseId: 2, weight: 108 }] })
        mockPrisma.phrase.findMany.mockResolvedValueOnce([
            { ...live, id: 1, word: change.oldWord, weight: 100 },
            { ...live, id: 2, word: change.word, weight: 105 },
        ])
        mockCheckBatchConflictsWithWeight.mockResolvedValueOnce([{
            id: String(change.id),
            conflict: { hasConflict: true, code: change.code, suggestions: [] },
        }])

        const { GET } = await import('./route')
        const response = await GET(request, { params: Promise.resolve({ id: 'batch-1' }) })
        expect(response.status).toBe(200)
        expect(mockCheckBatchConflictsWithWeight).toHaveBeenCalledWith([expect.objectContaining({ oldWord: change.oldWord })])
        expect(await response.json()).toMatchObject({ preview: {
            rejected: [{ prId: change.id, oldWord: change.oldWord, word: change.word }], changes: [],
        } })
    })

    it('keeps rejected proposal lines in the administrator review preview only', async () => {
        const batch = draftChangeBatch()
        mockPrisma.batch.findUnique.mockResolvedValue({
            ...batch,
            status: 'Submitted',
            itemReviewStarted: true,
            pullRequests: batch.pullRequests.map(pr => ({ ...pr, status: 'Rejected', appliedAt: null })),
        })
        mockCheckAdminPermission.mockResolvedValue({
            authorized: true,
            user: {
                id: 1, name: 'rea', roles: [], status: 'ENABLE', signUpType: 'USERNAME', tokenVersion: 0,
                createAt: new Date(0), updateAt: new Date(0), nickname: null, phone: null,
                password: null, email: null, qqId: null, telegramId: null,
            },
            session: { id: 1, name: 'rea' },
        })
        const { GET } = await import('./route')
        const context = { params: Promise.resolve({ id: 'batch-1' }) }
        const publicPreview = await (await GET(request, context)).json()
        const adminPreview = await (await GET(adminRequest, context)).json()

        expect(publicPreview.preview.changes).toEqual([])
        expect(adminPreview.preview.changes[0].diffs[0].itemId).toBe(1550)
    })

    it('checks admin access before reading the review preview', async () => {
        mockCheckAdminPermission.mockResolvedValue({
            authorized: false,
            response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
        })
        const { GET } = await import('./route')
        const result = await GET(adminRequest, { params: Promise.resolve({ id: 'batch-1' }) })

        expect(result.status).toBe(403)
        expect(mockPrisma.batch.findUnique).not.toHaveBeenCalled()
    })
})
