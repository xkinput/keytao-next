import { describe, expect, it, vi } from 'vitest'
import {
  BOT_BATCH_DESCRIPTION_PREFIX,
  botDraftBatchWhere,
  findCurrentBotDraftBatch,
  findCurrentBotDraftBatchId,
} from './botDraftBatch'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    description: '键道助手草稿批次',
    createAt: new Date('2026-08-01T00:00:00.000Z'),
    contentVersion: 2,
    _count: { pullRequests: 0 },
    ...overrides,
  }
}

function client(findFirst: ReturnType<typeof vi.fn>) {
  return { batch: { findFirst } } as unknown as Parameters<typeof findCurrentBotDraftBatch>[0]
}

describe('botDraftBatchWhere', () => {
  it('scopes to the caller and to bot-created drafts', () => {
    expect(botDraftBatchWhere(7)).toEqual({
      creatorId: 7,
      status: 'Draft',
      description: { startsWith: BOT_BATCH_DESCRIPTION_PREFIX },
    })
  })
})

describe('findCurrentBotDraftBatch', () => {
  it('prefers the draft that holds content over a newer empty one', async () => {
    const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
      where.pullRequests
        ? row({ id: 'has-content', _count: { pullRequests: 3 } })
        : row({ id: 'newer-empty', createAt: new Date('2026-08-04T00:00:00.000Z') })
    ))

    await expect(findCurrentBotDraftBatch(client(findFirst), 7)).resolves.toEqual({
      id: 'has-content',
      description: '键道助手草稿批次',
      createAt: new Date('2026-08-01T00:00:00.000Z'),
      contentVersion: 2,
      pullRequestCount: 3,
    })
    // The fallback query is not even issued when a draft holds content.
    expect(findFirst).toHaveBeenCalledTimes(1)
  })

  it('falls back to the newest draft when none hold content', async () => {
    const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
      where.pullRequests ? null : row({ id: 'newest-empty' })
    ))

    await expect(findCurrentBotDraftBatchId(client(findFirst), 7)).resolves.toBe('newest-empty')
    expect(findFirst).toHaveBeenCalledTimes(2)
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: { createAt: 'desc' },
    }))
  })

  it('returns null instead of creating anything when there is no draft', async () => {
    const findFirst = vi.fn(async () => null)

    await expect(findCurrentBotDraftBatch(client(findFirst), 7)).resolves.toBeNull()
    await expect(findCurrentBotDraftBatchId(client(findFirst), 7)).resolves.toBeNull()
  })
})
