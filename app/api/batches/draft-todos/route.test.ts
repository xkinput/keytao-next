import { Client } from 'pg'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { approveSubmittedBatch } from '@/lib/services/batchApprovalService'
import { recordItemReview, resubmitRejectedItem } from '@/lib/services/batchItemReview'
import { createTestBatch, createTestUser } from '@/lib/test/helpers'
import { POST as markRejectionRead } from '../[id]/rejection-read/route'
import { GET as listBatches } from '../route'
import { DELETE, GET } from './route'

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))

describe('draft todos and empty draft cleanup', () => {
  beforeEach(() => vi.mocked(getSession).mockReset())

  it('requires sign-in to count, list, or clear draft todos', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const responses = await Promise.all([
      GET(),
      DELETE(),
      listBatches(new NextRequest('http://localhost/api/batches?status=DraftTodos')),
    ])
    expect(responses.map(response => response.status)).toEqual([401, 401, 401])
  })

  it('counts only the current owner’s drafts and rejections and only clears the owner’s empty drafts', async () => {
    const owner = await createTestUser()
    const another = await createTestUser()
    vi.mocked(getSession).mockResolvedValue({ id: owner.id, name: 'owner' })
    const otherDraft = await prisma.batch.create({ data: { creatorId: another.id } })
    const ownDraft = await prisma.batch.create({ data: { creatorId: owner.id } })
    const rejected = await prisma.batch.create({ data: { creatorId: owner.id, status: 'Rejected' } })
    const submitted = await prisma.batch.create({ data: { creatorId: owner.id, status: 'Submitted' } })
    const approved = await prisma.batch.create({ data: { creatorId: owner.id, status: 'Approved' } })
    const { batch: nonempty } = await createTestBatch(owner.id, [
      { action: 'Create', word: '词条', code: 'citc' },
    ])

    const counts = await GET()
    expect(counts.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await counts.json()).toEqual({ unsubmitted: 2, rejected: 1, emptyDrafts: 1 })
    const list = await listBatches(new NextRequest('http://localhost/api/batches?status=DraftTodos&pageSize=1'))
    expect(list.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await list.json()).pagination.total).toBe(3)
    const ordinaryList = await listBatches(new NextRequest('http://localhost/api/batches?status=Draft&onlyMine=true'))
    expect((await ordinaryList.json()).pagination.total).toBe(2)

    expect(await (await DELETE()).json()).toEqual({ deleted: 1 })
    expect(await (await GET()).json()).toEqual({ unsubmitted: 1, rejected: 1, emptyDrafts: 0 })
    expect(await (await DELETE()).json()).toEqual({ deleted: 0 })
    const surviving = await prisma.batch.findMany({ select: { id: true } })
    expect(surviving.map(batch => batch.id).sort()).toEqual([
      otherDraft.id, nonempty.id, rejected.id, submitted.id, approved.id,
    ].sort())
    expect(await prisma.batch.findUnique({ where: { id: ownDraft.id } })).toBeNull()
  })

  it('marks a rejection read only for its owner and restores the todo on a new rejection', async () => {
    const owner = await createTestUser()
    const reviewer = await createTestUser()
    const { batch, prs: [item] } = await createTestBatch(owner.id, [
      { action: 'Create', word: '复审词', code: 'fuci' },
    ])
    const markRead = (expectedContentVersion: number) => markRejectionRead(
      new NextRequest(`http://localhost/api/batches/${batch.id}/rejection-read`, {
        method: 'POST',
        body: JSON.stringify({ expectedContentVersion }),
      }),
      { params: Promise.resolve({ id: batch.id }) },
    )
    const reject = async (version: number) => {
      await recordItemReview({
        batchId: batch.id, itemId: item.id, reviewerId: reviewer.id,
        decision: 'Rejected', reason: '依据不足', expectedContentVersion: version,
      })
      return (await approveSubmittedBatch({
        batchId: batch.id, reviewerId: reviewer.id,
        finalizeItemReview: true, expectedContentVersion: version + 1,
      })).batch
    }

    vi.mocked(getSession).mockResolvedValue(null)
    expect((await markRead(0)).status).toBe(401)
    vi.mocked(getSession).mockResolvedValue({ id: owner.id, name: 'owner' })
    expect((await markRead(0)).status).toBe(409)
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
    const firstRejection = await reject(0)
    expect((await (await GET()).json()).rejected).toBe(1)

    vi.mocked(getSession).mockResolvedValue({ id: reviewer.id, name: 'reviewer' })
    expect((await markRead(firstRejection.contentVersion)).status).toBe(409)
    vi.mocked(getSession).mockResolvedValue({ id: owner.id, name: 'owner' })
    expect((await (await GET()).json()).rejected).toBe(1)
    expect((await markRead(firstRejection.contentVersion)).status).toBe(200)
    expect((await markRead(firstRejection.contentVersion)).status).toBe(200)
    expect((await (await GET()).json()).rejected).toBe(0)
    const ownList = await listBatches(new NextRequest('http://localhost/api/batches?status=DraftTodos'))
    expect((await ownList.json()).batches).toMatchObject([{
      id: batch.id, status: 'Rejected', rejectionRead: true,
      contentVersion: firstRejection.contentVersion, updateAt: firstRejection.updateAt.toISOString(),
    }])
    const publicList = await listBatches(new NextRequest('http://localhost/api/batches?status=Rejected'))
    expect((await publicList.json()).batches[0]).not.toHaveProperty('rejectionRead')

    await resubmitRejectedItem(batch.id, item.id, owner.id, firstRejection.contentVersion)
    await reject(firstRejection.contentVersion + 1)
    expect((await markRead(firstRejection.contentVersion)).status).toBe(409)
    expect((await (await GET()).json()).rejected).toBe(1)
  })

  it('keeps a draft when an in-flight writer adds its first entry while cleanup waits', async () => {
    const owner = await createTestUser()
    vi.mocked(getSession).mockResolvedValue({ id: owner.id, name: 'owner' })
    const batch = await prisma.batch.create({ data: { creatorId: owner.id } })
    const writer = new Client({ connectionString: process.env.DATABASE_URL })
    await writer.connect()
    let cleanup: ReturnType<typeof DELETE> | undefined
    try {
      const { rows: [backend] } = await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      await writer.query('BEGIN')
      await writer.query('UPDATE batches SET "contentVersion" = "contentVersion" + 1 WHERE id = $1', [batch.id])
      cleanup = DELETE()
      await expect.poll(async () => {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND ${backend.pid}::integer = ANY(pg_blocking_pids(pid))
          ) AS waiting
        `
        return row.waiting
      }, { timeout: 2500 }).toBe(true)

      await writer.query(`
        INSERT INTO pull_requests ("batchId", "userId", "updateAt", word, code)
        VALUES ($1, $2, CURRENT_TIMESTAMP, '词条', 'citc')
      `, [batch.id, owner.id])
      await writer.query('COMMIT')
      expect(await (await cleanup).json()).toEqual({ deleted: 0 })
      expect(await prisma.pullRequest.count({ where: { batchId: batch.id } })).toBe(1)
    } finally {
      await writer.end()
      await cleanup
    }
  })
})
