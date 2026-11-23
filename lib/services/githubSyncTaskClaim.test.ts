import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (run: (tx: unknown) => unknown) => run({
      syncTask: { create: mocks.create },
      batch: { updateMany: mocks.updateMany },
    }),
  },
}))

import { BatchContentLockedError } from './batchContentGuard'
import { createGithubSyncTask } from './githubAutoSyncService'

describe('createGithubSyncTask', () => {
  const batches = [{ id: 'batch-a', contentVersion: 4 }, { id: 'batch-b', contentVersion: 7 }]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({ id: 'task-1' })
  })

  it('links every batch only if the approved and unclaimed snapshot still matches', async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 })

    await expect(createGithubSyncTask(batches, ['keytao.phrase.dict.yaml'], 12))
      .resolves.toEqual({ id: 'task-1' })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { status: 'Approved', syncTaskId: null, OR: batches },
      data: { syncTaskId: 'task-1', contentVersion: { increment: 1 } },
    })
  })

  it('aborts the transaction if any batch has changed or already been claimed', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 })

    await expect(createGithubSyncTask(batches, ['keytao.phrase.dict.yaml'], 12))
      .rejects.toBeInstanceOf(BatchContentLockedError)
  })

  it('permits a manual full sync with no batches', async () => {
    await expect(createGithubSyncTask([], ['keytao.phrase.dict.yaml'], 12))
      .resolves.toEqual({ id: 'task-1' })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
