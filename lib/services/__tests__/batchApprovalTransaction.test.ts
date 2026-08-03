import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BatchContentLockedError,
  claimBatchContentMutation,
} from '@/lib/services/batchContentGuard'
import {
  PhraseWeightConflictError,
  weightLockId,
} from '@/lib/services/phraseWeightLock'
import { createTestUser, seedPhrases, createTestBatch } from '@/lib/test/helpers'
import { prisma } from '@/lib/prisma'
import {
  approveSubmittedBatch,
  BatchApprovalTargetChangedError,
  BatchConcurrentUpdateError,
  BatchNeedsManualReviewError,
} from '@/lib/services/batchApprovalService'

async function submit(batchId: string) {
  await prisma.batch.update({ where: { id: batchId }, data: { status: 'Submitted' } })
}

describe('approveSubmittedBatch transactional guarantees', () => {
  let testUserId: number

  beforeEach(async () => {
    const user = await createTestUser()
    testUserId = user.id
  })

  it('records the reviewer and the review timestamp', async () => {
    const [target] = await seedPhrases(testUserId, [
      { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
    ])
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Delete', word: '如果', code: 'rjgl', type: 'Phrase', phraseId: target.id },
    ])
    await submit(batch.id)

    const reviewer = await createTestUser()
    const before = Date.now()

    const result = await approveSubmittedBatch({
      batchId: batch.id,
      reviewNote: '通过',
      reviewerId: reviewer.id,
    })

    expect(result.batch.status).toBe('Approved')
    expect(result.batch.reviewerId).toBe(reviewer.id)
    expect(result.batch.reviewedAt).toBeInstanceOf(Date)
    expect(result.batch.reviewedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('refuses to approve a batch that is no longer Submitted', async () => {
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Create', word: '新词', code: 'xinc', type: 'Phrase' },
    ])
    // Never submitted — stays in Draft.

    await expect(approveSubmittedBatch({ batchId: batch.id })).rejects.toThrow(
      '只能审核待审核状态的批次'
    )
  })

  it('lets only one of two concurrent approvals execute the batch', async () => {
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Create', word: '新词', code: 'xinc', type: 'Phrase' },
    ])
    await submit(batch.id)

    // Both reviewers pass the pre-flight status read before either transaction
    // commits; the guarded updateMany inside the transaction is what actually
    // serialises them.
    const [first, second] = await Promise.allSettled([
      approveSubmittedBatch({ batchId: batch.id, reviewerId: testUserId }),
      approveSubmittedBatch({ batchId: batch.id, reviewerId: testUserId }),
    ])

    const fulfilled = [first, second].filter(r => r.status === 'fulfilled')
    const rejected = [first, second].filter(r => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // The loser must fail on a status guard, not corrupt the batch.
    const reason = (rejected[0] as PromiseRejectedResult).reason
    const isGuardFailure =
      reason instanceof BatchConcurrentUpdateError ||
      (reason instanceof Error && reason.message === '只能审核待审核状态的批次')
    expect(isGuardFailure).toBe(true)

    // The decisive assertion: the Create was applied exactly once.
    const created = await prisma.phrase.findMany({ where: { word: '新词', code: 'xinc' } })
    expect(created).toHaveLength(1)
  })

  it('aborts the whole batch when a Change target is missing, instead of skipping it', async () => {
    await seedPhrases(testUserId, [{ word: '存在词', code: 'ccio', type: 'Phrase', weight: 100 }])
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Create', word: '新增词', code: 'xzci', type: 'Phrase' },
      { action: 'Change', oldWord: '不存在词', word: '改后词', code: 'bcio', type: 'Phrase' },
    ])
    await submit(batch.id)

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)

    // The batch must remain reviewable, and the sibling Create must not persist.
    const after = await prisma.batch.findUnique({ where: { id: batch.id } })
    expect(after!.status).toBe('Submitted')
    const created = await prisma.phrase.findFirst({ where: { word: '新增词', code: 'xzci' } })
    expect(created).toBeNull()
  })

  it('names every missing Change target in the error', async () => {
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Change', oldWord: '缺一', word: '改一', code: 'que', type: 'Phrase' },
    ])
    await submit(batch.id)

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)
  })

  it('treats an already-deleted phrase as an idempotent success', async () => {
    const [phrase] = await seedPhrases(testUserId, [
      { word: '待删词', code: 'dsci', type: 'Phrase', weight: 100 },
    ])
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Delete', word: '待删词', code: 'dsci', type: 'Phrase', phraseId: phrase.id },
    ])
    await submit(batch.id)

    // Someone removed the row before the review landed — this used to blow up
    // the whole batch with Prisma P2025.
    await prisma.phrase.delete({ where: { id: phrase.id } })

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)
    const after = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })
    expect(after.status).toBe('Submitted')
  })

  it('does NOT delete a different row that later took over the same tuple', async () => {
    // A Delete authorises removing one specific entity. If the original entry
    // is gone and an unrelated new entry now occupies the same
    // (word, code, type), deleting that newcomer would destroy an entry nobody
    // reviewed. Previously this TOCTOU was the documented behaviour.
    const [original] = await seedPhrases(testUserId, [
      { word: '搬家词', code: 'bjci', type: 'Phrase', weight: 100 },
    ])
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Delete', word: '搬家词', code: 'bjci', type: 'Phrase', phraseId: original.id },
    ])
    await submit(batch.id)

    // The reviewed entity disappears and a brand new row takes its place.
    await prisma.phrase.delete({ where: { id: original.id } })
    const [replacement] = await seedPhrases(testUserId, [
      { word: '搬家词', code: 'bjci', type: 'Phrase', weight: 100 },
    ])

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)

    // The unrelated newcomer survives untouched.
    const survivor = await prisma.phrase.findUnique({ where: { id: replacement.id } })
    expect(survivor).not.toBeNull()
  })

  it('refuses to guess a Delete target when the identity record is gone', async () => {
    // A legacy row whose phraseId was nulled by ON DELETE SET NULL before the
    // snapshot column existed. Its target identity is unrecoverable, so any
    // (word, code, type) lookup would be a guess — and a row sitting at that
    // tuple now may be completely unrelated to the one that was reviewed.
    // Blocking is strictly better than deleting a stranger.
    const { batch, prs } = await createTestBatch(testUserId, [
      { action: 'Delete', word: '后来词', code: 'hlci', type: 'Phrase' },
    ])
    await prisma.pullRequest.update({
      where: { id: prs[0].id },
      data: { phraseId: null, targetPhraseId: null },
    })
    await submit(batch.id)

    const [newcomer] = await seedPhrases(testUserId, [
      { word: '后来词', code: 'hlci', type: 'Phrase', weight: 100 },
    ])

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)

    expect(await prisma.phrase.findUnique({ where: { id: newcomer.id } })).not.toBeNull()
    const after = await prisma.batch.findUnique({ where: { id: batch.id } })
    expect(after!.status).toBe('Submitted')
  })

  it('refuses even when a plausible pre-existing row sits at the tuple', async () => {
    // The timestamp heuristic used to accept this case. It is not sound: under a
    // long transaction a replacement row can carry a createAt earlier than the
    // pull request, so "older than the PR" never proved "is the PR's target".
    const [plausible] = await seedPhrases(testUserId, [
      { word: '老词', code: 'lcio', type: 'Phrase', weight: 100 },
    ])
    await new Promise(resolve => setTimeout(resolve, 10))
    const { batch, prs } = await createTestBatch(testUserId, [
      { action: 'Delete', word: '老词', code: 'lcio', type: 'Phrase' },
    ])
    await prisma.pullRequest.update({
      where: { id: prs[0].id },
      data: { phraseId: null, targetPhraseId: null },
    })
    await submit(batch.id)

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)

    expect(await prisma.phrase.findUnique({ where: { id: plausible.id } })).not.toBeNull()
  })

  it('still lets an administrator approve a batch flagged for manual review', async () => {
    // The needsManualReview gate lives in the bot auto-approve route only —
    // approving through an administrator is exactly what the flag asks for.
    const { batch, prs } = await createTestBatch(testUserId, [
      { action: 'Create', word: '存疑词', code: 'cyci', type: 'Phrase' },
    ])
    await prisma.pullRequest.update({
      where: { id: prs[0].id },
      data: { needsManualReview: true },
    })
    await submit(batch.id)

    const result = await approveSubmittedBatch({
      batchId: batch.id,
      mode: 'admin',
      reviewerId: testUserId,
    })

    expect(result.batch.status).toBe('Approved')
    const created = await prisma.phrase.findFirst({ where: { word: '存疑词', code: 'cyci' } })
    expect(created).not.toBeNull()
  })

  it('blocks bot auto-approval on a flagged entry from inside the transaction', async () => {
    const { batch, prs } = await createTestBatch(testUserId, [
      { action: 'Create', word: '存疑词', code: 'cyci', type: 'Phrase' },
    ])
    await prisma.pullRequest.update({
      where: { id: prs[0].id },
      data: { needsManualReview: true },
    })
    await submit(batch.id)

    await expect(approveSubmittedBatch({ batchId: batch.id, mode: 'bot-auto', allowDelete: false }))
      .rejects.toBeInstanceOf(BatchNeedsManualReviewError)

    // Rolled back: still reviewable, nothing written.
    const after = await prisma.batch.findUnique({ where: { id: batch.id } })
    expect(after!.status).toBe('Submitted')
    expect(await prisma.phrase.findFirst({ where: { word: '存疑词' } })).toBeNull()
  })

  describe('ABA races: edits landing between the pre-flight snapshot and execution', () => {
    /**
     * Run `approveSubmittedBatch`, injecting a committed edit at a controlled
     * point: after the pre-flight snapshot has been taken but before the
     * approval transaction opens. This is the exact window that a
     * recall -> edit -> re-submit sequence exploits, and the one that extra
     * in-transaction re-reads cannot close on their own.
     */
    async function approveWithInjectedEdit(
      batchId: string,
      inject: () => Promise<void>
    ) {
      // Intercept the moment the approval transaction is about to open: by then
      // the batch, its pull requests, the conflict results and the execution
      // order have all been read outside any transaction. Committing the edit
      // here reproduces the real race exactly, with no timing luck involved.
      const realTransaction = prisma.$transaction.bind(prisma)
      const spy = vi
        .spyOn(prisma, '$transaction')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((async (fn: any, ...rest: any[]) => {
          // Only intercept the first (outermost) transaction.
          spy.mockRestore()
          await inject()
          return realTransaction(fn, ...rest)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any)

      try {
        return await approveSubmittedBatch({
          batchId,
          mode: 'bot-auto',
          allowDelete: false,
        })
      } finally {
        spy.mockRestore()
      }
    }

    it('rejects when a flagged PR is inserted after the snapshot', async () => {
      const { batch } = await createTestBatch(testUserId, [
        { action: 'Create', word: '干净词', code: 'gjci', type: 'Phrase' },
      ])
      await submit(batch.id)

      await expect(
        approveWithInjectedEdit(batch.id, async () => {
          // A concurrent draft write that slipped in: recall -> add -> re-submit.
          await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Draft' } })
          await prisma.batch.update({
            where: { id: batch.id },
            data: { contentVersion: { increment: 1 } },
          })
          await prisma.pullRequest.create({
            data: {
              action: 'Create',
              word: '偷渡词',
              code: 'tdci',
              type: 'Phrase',
              userId: testUserId,
              batchId: batch.id,
              needsManualReview: true,
            },
          })
          await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
        })
      ).rejects.toBeInstanceOf(BatchConcurrentUpdateError)

      const after = await prisma.batch.findUnique({ where: { id: batch.id } })
      expect(after!.status).toBe('Submitted')
      expect(await prisma.phrase.findFirst({ where: { word: '干净词' } })).toBeNull()
      expect(await prisma.phrase.findFirst({ where: { word: '偷渡词' } })).toBeNull()
    })

    it('rejects when an existing PR changes content under the same id', async () => {
      // The nastiest variant: the PR id set is identical, only the content
      // differs. An id-set comparison cannot see this — the version can.
      const { batch, prs } = await createTestBatch(testUserId, [
        { action: 'Create', word: '原词', code: 'yuci', type: 'Phrase' },
      ])
      await submit(batch.id)

      await expect(
        approveWithInjectedEdit(batch.id, async () => {
          await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Draft' } })
          await prisma.batch.update({
            where: { id: batch.id },
            data: { contentVersion: { increment: 1 } },
          })
          await prisma.pullRequest.update({
            where: { id: prs[0].id },
            data: { word: '掉包词', code: 'dbci' },
          })
          await prisma.batch.update({ where: { id: batch.id }, data: { status: 'Submitted' } })
        })
      ).rejects.toBeInstanceOf(BatchConcurrentUpdateError)

      // Neither the old nor the swapped content may reach the dictionary.
      expect(await prisma.phrase.findFirst({ where: { word: '原词' } })).toBeNull()
      expect(await prisma.phrase.findFirst({ where: { word: '掉包词' } })).toBeNull()
      const after = await prisma.batch.findUnique({ where: { id: batch.id } })
      expect(after!.status).toBe('Submitted')
    })

    it('approves normally when nothing changed after the snapshot', async () => {
      // Control: the guard must not reject legitimate approvals.
      const { batch } = await createTestBatch(testUserId, [
        { action: 'Create', word: '正常词', code: 'zcci', type: 'Phrase' },
      ])
      await submit(batch.id)

      const result = await approveWithInjectedEdit(batch.id, async () => {})

      expect(result.batch.status).toBe('Approved')
      expect(await prisma.phrase.findFirst({ where: { word: '正常词' } })).not.toBeNull()
    })

    it('serialises a real approval racing a real content claim on the same row', async () => {
      // Not a staged sequence of autocommits: both sides run concurrently and
      // genuinely contend for the batch row. One blocks on the other's row lock,
      // then re-evaluates its WHERE against the newer snapshot and finds it no
      // longer satisfied. Exactly one may win.
      const { batch } = await createTestBatch(testUserId, [
        { action: 'Create', word: '竞争词', code: 'jzci', type: 'Phrase' },
      ])
      await submit(batch.id)

      // Explicit barrier: the approver is not allowed to start until the editor
      // has *actually acquired* the batch row lock. Without this the two may
      // simply run one after the other and the test would pass while proving
      // nothing about blocking.
      let signalRowLocked: () => void
      const rowLocked = new Promise<void>(resolve => { signalRowLocked = resolve })
      let recallCount = -1

      // The editor must first move the batch back to an editable state, exactly
      // as a recall would. That UPDATE is what takes the row lock.
      const editor = (async () => {
        await prisma.$transaction(async (tx) => {
          const recall = await tx.batch.updateMany({
            where: { id: batch.id, status: 'Submitted' },
            data: { status: 'Draft' },
          })
          recallCount = recall.count
          // The row lock is now held by this transaction.
          signalRowLocked()
          // Stay inside the transaction long enough that the approver must
          // block on the lock rather than racing ahead of it.
          await new Promise(resolve => setTimeout(resolve, 150))
          await claimBatchContentMutation(tx, batch.id, {
            creatorId: testUserId,
            expectedContentVersion: batch.contentVersion,
          })
          await tx.pullRequest.create({
            data: {
              action: 'Create',
              word: '插入词',
              code: 'crci',
              type: 'Phrase',
              userId: testUserId,
              batchId: batch.id,
            },
          })
        })
      })()

      await rowLocked
      const approver = approveSubmittedBatch({ batchId: batch.id, reviewerId: testUserId })

      const [editorResult, approverResult] = await Promise.allSettled([editor, approver])

      // The editor really did win the row first.
      expect(recallCount).toBe(1)

      // Whatever the interleaving, the two must not both succeed.
      const bothSucceeded =
        editorResult.status === 'fulfilled' && approverResult.status === 'fulfilled'
      expect(bothSucceeded).toBe(false)

      // The editor got there first, so the approval must be the one that loses:
      // it blocks on the row, then re-evaluates `status = 'Submitted'` against
      // the committed Draft and matches zero rows.
      expect(editorResult.status).toBe('fulfilled')
      expect(approverResult.status).toBe('rejected')

      // And the dictionary must agree with the batch's final state.
      const finalBatch = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })
      const applied = await prisma.phrase.findFirst({ where: { word: '竞争词', code: 'jzci' } })
      if (finalBatch.status === 'Approved') {
        expect(applied).not.toBeNull()
      } else {
        expect(applied).toBeNull()
      }
    })

    it('never assigns the same weight twice when two batches create at one code', async () => {
      // Different batches are different rows, so the batch-row serialisation
      // cannot help here — the (code, type) advisory lock is what does.
      await seedPhrases(testUserId, [
        { word: '占位词', code: 'tongma', type: 'Phrase', weight: 100 },
      ])

      const batches = await Promise.all([
        createTestBatch(testUserId, [
          { action: 'Create', word: '甲词', code: 'tongma', type: 'Phrase' },
        ]),
        createTestBatch(testUserId, [
          { action: 'Create', word: '乙词', code: 'tongma', type: 'Phrase' },
        ]),
      ])
      await Promise.all(batches.map(b => submit(b.batch.id)))

      const results = await Promise.allSettled(
        batches.map(b => approveSubmittedBatch({ batchId: b.batch.id, reviewerId: testUserId }))
      )
      expect(results.every(r => r.status === 'fulfilled')).toBe(true)

      const created = await prisma.phrase.findMany({
        where: { code: 'tongma', type: 'Phrase' },
        select: { word: true, weight: true },
      })
      expect(created).toHaveLength(3)
      const weights = created.map(p => p.weight)
      expect(new Set(weights).size).toBe(weights.length)
    })
  })

  it('rejects a content mutation attempted while the batch is not editable', async () => {
    // The other half of the guarantee: writers cannot touch a Submitted batch.
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Create', word: '锁定词', code: 'sdci', type: 'Phrase' },
    ])
    await submit(batch.id)

    await expect(
      prisma.$transaction(async (tx) => {
        await claimBatchContentMutation(tx, batch.id, {
          creatorId: testUserId,
          expectedContentVersion: batch.contentVersion,
        })
      })
    ).rejects.toBeInstanceOf(BatchContentLockedError)
  })

  it('deletes with the full predicate, so a concurrent rewrite cannot be hit', async () => {
    // The snapshot branch must delete with id AND word AND code AND type in one
    // statement. If the row was rewritten after the PR was created, the delete
    // matches nothing and we must report a mismatch rather than removing it.
    const [target] = await seedPhrases(testUserId, [
      { word: '原目标', code: 'ymbi', type: 'Phrase', weight: 100 },
    ])
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Delete', word: '原目标', code: 'ymbi', type: 'Phrase', phraseId: target.id },
    ])
    await submit(batch.id)

    // Another batch rewrote the very same row before this approval ran.
    await prisma.phrase.update({
      where: { id: target.id },
      data: { word: '改后目标' },
    })

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)

    const survivor = await prisma.phrase.findUnique({ where: { id: target.id } })
    expect(survivor).not.toBeNull()
    expect(survivor!.word).toBe('改后目标')
  })

  it('rejects a batch that would leave two candidates sharing a weight', async () => {
    // Explicit weights bypass recomputation, so the advisory lock alone cannot
    // stop a collision — the in-lock uniqueness check is what catches it.
    await seedPhrases(testUserId, [
      { word: '既有词', code: 'chma', type: 'Phrase', weight: 101 },
    ])
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Create', word: '新词', code: 'chma', type: 'Phrase', weight: 101 },
    ])
    await submit(batch.id)

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(PhraseWeightConflictError)

    // Rolled back: the colliding entry was not written.
    expect(await prisma.phrase.findFirst({ where: { word: '新词', code: 'chma' } })).toBeNull()
  })

  it('locks weight slots in a globally consistent order', () => {
    // Ordering must follow the numeric lock id, not the source string: sorting
    // by string while locking by hash lets a collision invert the order of two
    // keys between two transactions, which deadlocks.
    const slots = [
      { code: 'zzz', type: 'Phrase' },
      { code: 'aaa', type: 'Phrase' },
      { code: 'mmm', type: 'Single' },
    ]
    const ids = slots.map(s => weightLockId(s.code, s.type))
    const sorted = [...ids].sort((a, b) => a - b)

    // Deterministic and stable across calls.
    expect(slots.map(s => weightLockId(s.code, s.type))).toEqual(ids)
    // Every id fits the int4 range pg_advisory_xact_lock(int, int) accepts.
    for (const id of ids) {
      expect(Number.isInteger(id)).toBe(true)
      expect(id).toBeGreaterThanOrEqual(-(2 ** 31))
      expect(id).toBeLessThan(2 ** 31)
    }
    expect(sorted).toHaveLength(3)
  })

  it('discards an AI review whose batch changed while it was running', async () => {
    const { writeMiaomiaoBatchReview, StaleBatchReviewError } =
      await import('@/lib/services/batchBotReviewService')
    const { batch, prs } = await createTestBatch(testUserId, [
      { action: 'Create', word: '过期复审', code: 'gqfs', type: 'Phrase' },
    ])
    await submit(batch.id)

    const reviewed = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })

    // An edit lands while the (slow) AI review is still running.
    await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, batch.id, {
        expectedContentVersion: reviewed.contentVersion,
        allowedStatuses: ['Draft', 'Rejected', 'Submitted'],
      })
    })

    await expect(writeMiaomiaoBatchReview({
      batch: {
        id: batch.id,
        status: 'Submitted',
        pullRequests: [{ id: prs[0].id, remark: null }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      aiReview: {
        generatedAt: new Date().toISOString(),
        items: [{
          prId: prs[0].id,
          status: 'pass',
          severity: 'success',
          title: '本喵建议通过',
          reasons: [],
          suggestions: [],
        }],
        suggestedReviewNote: '可通过',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      expectedContentVersion: reviewed.contentVersion,
    })).rejects.toBeInstanceOf(StaleBatchReviewError)

    // The stale verdict was not written anywhere.
    const pr = await prisma.pullRequest.findUniqueOrThrow({ where: { id: prs[0].id } })
    expect(pr.remark).toBeNull()
  })

  it('rolls back the whole cross-batch delete when one batch is no longer editable', async () => {
    // The count check must happen inside the transaction: validating afterwards
    // would leave the first batch's rows permanently deleted while telling the
    // caller the request failed.
    const a = await createTestBatch(testUserId, [
      { action: 'Create', word: '甲留存', code: 'jlci', type: 'Phrase' },
    ])
    const b = await createTestBatch(testUserId, [
      { action: 'Create', word: '乙留存', code: 'ylci', type: 'Phrase' },
    ])
    // Batch B leaves the editable states, so its claim will fail.
    await submit(b.batch.id)

    await expect(prisma.$transaction(async (tx) => {
      for (const [batchId, ids] of [
        [a.batch.id, [a.prs[0].id]],
        [b.batch.id, [b.prs[0].id]],
      ] as Array<[string, number[]]>) {
        const source = batchId === a.batch.id ? a.batch : b.batch
        await claimBatchContentMutation(tx, batchId, {
          creatorId: testUserId,
          expectedContentVersion: source.contentVersion,
        })
        await tx.pullRequest.deleteMany({ where: { id: { in: ids }, batchId } })
      }
    })).rejects.toBeInstanceOf(BatchContentLockedError)

    // Batch A's pull request must still be there.
    expect(await prisma.pullRequest.findUnique({ where: { id: a.prs[0].id } })).not.toBeNull()
  })

  it('routes bot review remarks through the content guard', async () => {
    // `remark` is copied onto the Phrase at approval, so rewriting it is a
    // content mutation and must move contentVersion like any other.
    const { writeMiaomiaoBatchReview } = await import('@/lib/services/batchBotReviewService')
    const { batch, prs } = await createTestBatch(testUserId, [
      { action: 'Create', word: '复审词', code: 'fsci', type: 'Phrase' },
    ])
    await submit(batch.id)

    const before = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })

    await writeMiaomiaoBatchReview({
      batch: {
        id: batch.id,
        status: 'Submitted',
        pullRequests: [{ id: prs[0].id, remark: null }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      aiReview: {
        generatedAt: new Date().toISOString(),
        items: [{
          prId: prs[0].id,
          status: 'pass',
          severity: 'success',
          title: '本喵建议通过',
          reasons: [],
          suggestions: [],
        }],
        suggestedReviewNote: '可通过',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      expectedContentVersion: before.contentVersion,
    })

    const after = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })
    expect(after.contentVersion).toBeGreaterThan(before.contentVersion)

    const updatedPr = await prisma.pullRequest.findUniqueOrThrow({ where: { id: prs[0].id } })
    expect(updatedPr.remark).toContain('本喵')
  })

  it('refuses to delete a batch that already left the editable states', async () => {
    // Pull requests cascade with the batch, so deleting an approved batch would
    // erase the audit trail of dictionary changes that already landed.
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Create', word: '审计词', code: 'sjci', type: 'Phrase' },
    ])
    await submit(batch.id)
    await approveSubmittedBatch({ batchId: batch.id, reviewerId: testUserId })

    const removed = await prisma.batch.deleteMany({
      where: { id: batch.id, status: { in: ['Draft', 'Rejected'] } },
    })

    expect(removed.count).toBe(0)
    expect(await prisma.batch.findUnique({ where: { id: batch.id } })).not.toBeNull()
    expect(await prisma.pullRequest.count({ where: { batchId: batch.id } })).toBe(1)
  })

  it('bumps contentVersion for every batch touched by a cross-batch delete', async () => {
    // A bulk delete spanning two batches must claim both, or one batch changes
    // without its version moving and a stale approval could still execute it.
    const a = await createTestBatch(testUserId, [
      { action: 'Create', word: '甲批词', code: 'jpci', type: 'Phrase' },
    ])
    const b = await createTestBatch(testUserId, [
      { action: 'Create', word: '乙批词', code: 'ypci', type: 'Phrase' },
    ])

    const beforeA = await prisma.batch.findUniqueOrThrow({ where: { id: a.batch.id } })
    const beforeB = await prisma.batch.findUniqueOrThrow({ where: { id: b.batch.id } })

    // Mirrors the grouped claim the bulk DELETE routes perform.
    await prisma.$transaction(async (tx) => {
      for (const [batchId, ids] of [
        [a.batch.id, [a.prs[0].id]],
        [b.batch.id, [b.prs[0].id]],
      ] as Array<[string, number[]]>) {
        const snapshot = batchId === a.batch.id ? beforeA : beforeB
        await claimBatchContentMutation(tx, batchId, {
          creatorId: testUserId,
          expectedContentVersion: snapshot.contentVersion,
        })
        await tx.pullRequest.deleteMany({ where: { id: { in: ids }, batchId } })
      }
    })

    const afterA = await prisma.batch.findUniqueOrThrow({ where: { id: a.batch.id } })
    const afterB = await prisma.batch.findUniqueOrThrow({ where: { id: b.batch.id } })

    expect(afterA.contentVersion).toBe(beforeA.contentVersion + 1)
    expect(afterB.contentVersion).toBe(beforeB.contentVersion + 1)
  })

  it('bumps contentVersion on every successful content claim', async () => {
    const { batch } = await createTestBatch(testUserId, [])

    const before = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })
    await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, batch.id, {
        creatorId: testUserId,
        expectedContentVersion: before.contentVersion,
      })
    })
    const after = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })

    expect(after.contentVersion).toBe(before.contentVersion + 1)
  })

  it('aborts when a PR target id does not match the word and code it claims', async () => {
    // A crafted phraseId must not delete an unrelated entry — and must not be
    // waved through as "already deleted" either: the row is still there, it
    // simply is not what the PR describes. That is a real inconsistency.
    const [victim] = await seedPhrases(testUserId, [
      { word: '无辜词', code: 'wgci', type: 'Phrase', weight: 100 },
    ])
    const { batch } = await createTestBatch(testUserId, [
      // Claims to delete 目标词/mbci but points at the victim's row.
      { action: 'Delete', word: '目标词', code: 'mbci', type: 'Phrase', phraseId: victim.id },
    ])
    await submit(batch.id)

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)

    // The innocent row survives and the batch stays reviewable.
    const survivor = await prisma.phrase.findUnique({ where: { id: victim.id } })
    expect(survivor).not.toBeNull()
    expect(survivor!.word).toBe('无辜词')
    const after = await prisma.batch.findUnique({ where: { id: batch.id } })
    expect(after!.status).toBe('Submitted')
  })

  it('aborts a Change that carries neither a resolvable triple nor a phraseId', async () => {
    const { batch } = await createTestBatch(testUserId, [
      // No oldWord and no phraseId: nothing to apply.
      { action: 'Change', word: '改后词', code: 'ghci', type: 'Phrase' },
    ])
    await submit(batch.id)

    await expect(approveSubmittedBatch({ batchId: batch.id }))
      .rejects.toBeInstanceOf(BatchApprovalTargetChangedError)

    const after = await prisma.batch.findUnique({ where: { id: batch.id } })
    expect(after!.status).toBe('Submitted')
  })

  it('scopes a Delete to its own dictionary type', async () => {
    const [phraseRow] = await seedPhrases(testUserId, [
      { word: '同形词', code: 'txci', type: 'Phrase', weight: 100 },
      { word: '同形词', code: 'txci', type: 'Single', weight: 10 },
    ])
    const { batch } = await createTestBatch(testUserId, [
      { action: 'Delete', word: '同形词', code: 'txci', type: 'Phrase', phraseId: phraseRow.id },
    ])
    await submit(batch.id)

    await approveSubmittedBatch({ batchId: batch.id })

    const survivors = await prisma.phrase.findMany({ where: { word: '同形词', code: 'txci' } })
    expect(survivors).toHaveLength(1)
    expect(survivors[0].type).toBe('Single')
  })
})
