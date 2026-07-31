import { describe, expect, it, vi } from 'vitest'
import {
  assertNoOtherBotDraftWithContent,
  BatchContentLockedError,
  claimBatchContentMutation,
  lockBotDraftUser,
} from './batchContentGuard'

describe('claimBatchContentMutation', () => {
  it('increments the owned editable batch row before content changes', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))

    await claimBatchContentMutation({ batch: { updateMany } } as never, 'batch-1', {
      creatorId: 42,
      expectedContentVersion: 8,
      allowedStatuses: ['Draft', 'Rejected', 'Submitted'],
    })

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-1',
        creatorId: 42,
        contentVersion: 8,
        status: { in: ['Draft', 'Rejected', 'Submitted'] },
      },
      data: { contentVersion: { increment: 1 } },
    })
  })

  it('fails closed when the batch row is no longer editable', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }))

    await expect(
      claimBatchContentMutation({ batch: { updateMany } } as never, 'batch-1', {
        expectedContentVersion: 3,
      })
    ).rejects.toBeInstanceOf(BatchContentLockedError)
  })

  it('serializes bot draft selection by user and rejects a second content draft', async () => {
    const executeRawUnsafe = vi.fn(async () => 1)
    const findFirst = vi.fn(async () => ({ id: 'other-batch' }))
    const tx = { $executeRawUnsafe: executeRawUnsafe, batch: { findFirst } } as never

    await lockBotDraftUser(tx, 42)
    await expect(assertNoOtherBotDraftWithContent(tx, 42, 'target-batch'))
      .rejects.toBeInstanceOf(BatchContentLockedError)

    expect(executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1, $2)', 0x4b54, 42
    )
  })
})
