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

  it('returns only bound, non-empty idle drafts, ordered by their latest change', async () => {
    const now = Date.now()
    const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000)
    const qqId = `test-${randomUUID()}`
    const bound = await prisma.user.create({ data: { qqId, email: `test_${randomUUID()}@example.com` } })
    const unbound = await prisma.user.create({ data: { email: `test_${randomUUID()}@example.com` } })

    function createBatch({
      creatorId = bound.id,
      description = 'Web draft',
      status = 'Draft',
      batchUpdated = 90,
      itemsUpdated = [90],
      contentVersion = 0,
    }: {
      creatorId?: number
      description?: string
      status?: BatchStatus
      batchUpdated?: number
      itemsUpdated?: number[]
      contentVersion?: number
    } = {}) {
      return prisma.batch.create({
        data: {
          creatorId, description, status, contentVersion, updateAt: minutesAgo(batchUpdated),
          pullRequests: { create: itemsUpdated.map(minutes => ({
            userId: creatorId,
            word: 'private draft item',
            updateAt: minutesAgo(minutes),
          })) },
        },
        include: { pullRequests: true },
      })
    }

    const personalApi = await createBatch({ description: '个人 API 草稿批次', itemsUpdated: [30], contentVersion: 3 })
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

    vi.stubEnv('KEYTAO_PUBLIC_BASE_QQ', 'https://qq.example.test/')
    const limited = await request('?idleMinutes=20&limit=1')
    expect(await limited.json()).toEqual({
      success: true,
      drafts: [{ ...expected[0], batchUrl: `https://qq.example.test/batch/${web.id}` }],
    })
    expect(await (await request('?idleMinutes=60')).json()).toEqual({ success: true, drafts: [] })
  })
})
