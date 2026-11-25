import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import type { BatchStatus } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/bot/drafts/idle/route'
import { prisma } from '@/lib/prisma'

vi.mock('next/headers', () => ({ headers: vi.fn() }))

const token = 'test-idle-drafts-token'

function request(query = '') {
  return GET(new NextRequest(`http://localhost/api/bot/drafts/idle${query}`))
}

beforeEach(() => {
  vi.stubEnv('BOT_API_TOKEN', token)
  vi.stubEnv('KEYTAO_PUBLIC_BASE_QQ', '')
  vi.mocked(headers).mockResolvedValue(new Headers({ 'x-bot-token': token }))
})

afterEach(() => vi.unstubAllEnvs())

describe('idle drafts for Bot reminders', () => {
  it('requires a bot token', async () => {
    vi.mocked(headers).mockResolvedValue(new Headers())
    const response = await request()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, message: '未授权' })
  })

  it('rejects fractional and out-of-range parameters', async () => {
    for (const query of ['?idleMinutes=4', '?idleMinutes=1441', '?idleMinutes=5.5', '?limit=0', '?limit=101', '?limit=1.5']) {
      expect((await request(query)).status).toBe(400)
    }
  })

  it('rejects malformed modifiedAfter timestamps', async () => {
    for (const modifiedAfter of ['', '2026-11-26', '2026-02-29T00:00:00Z', '2026-11-26T00:00:00+24:00']) {
      expect((await request(`?${new URLSearchParams({ modifiedAfter })}`)).status).toBe(400)
    }
  })

  it('requires modifiedAfter when afterId is provided', async () => {
    expect((await request('?afterId=batch-id')).status).toBe(400)
  })

  it('returns drafts with the same modification time in ID order across pages', async () => {
    const now = Date.now()
    const tied = new Date(now - 60 * 60_000)
    const later = new Date(now - 30 * 60_000)
    const prefix = randomUUID()
    const { id: creatorId } = await prisma.user.create({
      data: { qqId: `test-${prefix}`, email: `test_${prefix}@example.com` },
    })
    for (const suffix of [4, 1, 3, 2]) {
      const updateAt = suffix === 1 ? later : tied
      await prisma.batch.create({
        data: {
          id: `${prefix}-${suffix}`, creatorId, updateAt,
          pullRequests: { create: { userId: creatorId, word: 'private draft item', updateAt } },
        },
      })
    }

    const first = await request('?limit=2')
    expect(first.status).toBe(200)
    const { drafts: firstPage } = await first.json()
    expect(firstPage).toMatchObject([
      { batchId: `${prefix}-2`, lastModifiedAt: tied.toISOString() },
      { batchId: `${prefix}-3`, lastModifiedAt: tied.toISOString() },
    ])

    const { batchId: afterId, lastModifiedAt: modifiedAfter } = firstPage[1]
    const query = new URLSearchParams({ modifiedAfter, afterId, limit: '2' })
    const second = await request(`?${query}`)
    expect(second.status).toBe(200)
    expect((await second.json()).drafts).toMatchObject([
      { batchId: `${prefix}-4`, lastModifiedAt: tied.toISOString() },
      { batchId: `${prefix}-1`, lastModifiedAt: later.toISOString() },
    ])
  })

  it('orders eligible drafts by their latest change and applies filters before the limit', async () => {
    const now = Date.now()
    const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000)
    const qqId = `test-${randomUUID()}`
    const bound = await prisma.user.create({ data: { qqId, email: `test_${randomUUID()}@example.com` } })
    const unbound = await prisma.user.create({ data: { email: `test_${randomUUID()}@example.com` } })

    function createBatch({
      id,
      creatorId = bound.id,
      description = 'Web draft',
      status = 'Draft',
      batchUpdated = 90,
      itemsUpdated = [90],
      contentVersion = 0,
    }: {
      id?: string
      creatorId?: number
      description?: string
      status?: BatchStatus
      batchUpdated?: number
      itemsUpdated?: number[]
      contentVersion?: number
    } = {}) {
      return prisma.batch.create({
        data: {
          id, creatorId, description, status, contentVersion, updateAt: minutesAgo(batchUpdated),
          pullRequests: { create: itemsUpdated.map(minutes => ({
            userId: creatorId,
            word: 'private draft item',
            updateAt: minutesAgo(minutes),
          })) },
        },
        include: { pullRequests: true },
      })
    }

    const personalApi = await createBatch({
      id: `personal-api-${randomUUID()}`, description: '个人 API 草稿批次', itemsUpdated: [30], contentVersion: 3,
    })
    const web = await createBatch({ batchUpdated: 40, itemsUpdated: [120, 55], contentVersion: 7 })
    for (const status of ['Submitted', 'Rejected', 'Approved'] as const) {
      await createBatch({ status })
    }
    await createBatch({ creatorId: unbound.id })
    await createBatch({ itemsUpdated: [] })
    await createBatch({ batchUpdated: 10 })
    const edited = await createBatch({ itemsUpdated: [80, 90] })
    await prisma.pullRequest.update({ where: { id: edited.pullRequests[0].id }, data: { word: 'recent edit' } })

    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const expected = [
      {
        batchId: web.id, creatorQqId: qqId, itemCount: 2, contentVersion: 7,
        lastModifiedAt: minutesAgo(40).toISOString(), batchUrl: `https://keytao.rea.ink/batch/${web.id}`,
      },
      {
        batchId: personalApi.id, creatorQqId: qqId, itemCount: 1, contentVersion: 3,
        lastModifiedAt: minutesAgo(30).toISOString(), batchUrl: `https://keytao.rea.ink/batch/${personalApi.id}`,
      },
    ]
    expect(await response.json()).toEqual({ success: true, drafts: expected })

    for (const minutes of [35, 40]) {
      const query = new URLSearchParams({ modifiedAfter: minutesAgo(minutes).toISOString(), limit: '1' })
      expect(await (await request(`?${query}`)).json()).toEqual({ success: true, drafts: [expected[1]] })
    }
    expect(await (await request(`?excludeIds=${web.id}&limit=1`)).json())
      .toEqual({ success: true, drafts: [expected[1]] })
    expect(await (await request(`?excludeIds=${web.id},${personalApi.id}&limit=1`)).json())
      .toEqual({ success: true, drafts: [] })

    const excessiveIds = [web.id, ...Array.from({ length: 200 }, () => randomUUID())].join(',')
    for (const excludeIds of [`${web.id},,${personalApi.id}`, excessiveIds]) {
      expect(await (await request(`?excludeIds=${excludeIds}&limit=1`)).json())
        .toEqual({ success: true, drafts: [expected[0]] })
    }

    vi.stubEnv('KEYTAO_PUBLIC_BASE_QQ', 'https://qq.example.test/')
    const limited = await request('?idleMinutes=20&limit=1')
    expect(await limited.json()).toEqual({
      success: true,
      drafts: [{ ...expected[0], batchUrl: `https://qq.example.test/batch/${web.id}` }],
    })
    expect(await (await request('?idleMinutes=60')).json()).toEqual({ success: true, drafts: [] })
  })
})
