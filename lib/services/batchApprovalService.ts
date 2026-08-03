import { prisma } from '@/lib/prisma'
import type { Batch } from '@prisma/client'
import type { BatchConflictResult } from '@/lib/services/batchConflictService'
import { detectPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchPRItem } from '@/lib/services/batchConflictService'
import {
  assertNoDuplicateWeights,
  lockPhraseWeightSlots,
  type PhraseWeightSlot,
} from '@/lib/services/phraseWeightLock'
import {
  buildBotWarningDigest,
  lockPhraseTableForWarningSnapshot,
} from '@/lib/services/botWarningSnapshot'
import { createPhraseTargetFingerprint } from '@/lib/services/phraseTargetBinding'

export type BatchApprovalMode = 'admin' | 'bot-auto'

export interface ApproveSubmittedBatchOptions {
  batchId: string
  reviewNote?: string | null
  mode?: BatchApprovalMode
  allowDelete?: boolean
  expectedContentVersion?: number
  /** User id of whoever actually performed the review (admin or bot account). */
  reviewerId?: number | null
  /**
   * Refuse the batch when any entry carries `needsManualReview`.
   * Defaults to true for `bot-auto`, false for `admin` — a human reviewer is
   * exactly what the flag asks for.
   */
  blockNeedsManualReview?: boolean
}

export interface ApproveSubmittedBatchResult {
  batch: Batch
}

/**
 * Raised when the batch left `Submitted` between the pre-flight read and the
 * transactional state transition (another reviewer won the race, or the author
 * withdrew it). Callers should surface this as HTTP 409.
 */
export class BatchConcurrentUpdateError extends Error {
  readonly status = 409

  constructor(message = '批次状态已被其他操作修改，请刷新后重试') {
    super(message)
    this.name = 'BatchConcurrentUpdateError'
  }
}

export class BatchApprovalTargetChangedError extends Error {
  readonly status = 409

  constructor(message = '审批目标词条已变化或缺少实体绑定，请重新创建批次') {
    super(message)
    this.name = 'BatchApprovalTargetChangedError'
  }
}

/**
 * Raised when a batch still contains entries keytao-bot flagged as needing a
 * human look. Only bot auto-approval is blocked; administrators may approve.
 */
export class BatchNeedsManualReviewError extends Error {
  readonly status = 422

  constructor(readonly flagged: Array<{ word: string; code: string }>) {
    const labels = flagged
      .slice(0, 5)
      .map(item => `「${item.word}」@${item.code}`)
      .join('、')
    const suffix = flagged.length > 5 ? ` 等 ${flagged.length} 条` : ''
    super(`以下词条需要人工复核，已保留给管理员审核：${labels}${suffix}`)
    this.name = 'BatchNeedsManualReviewError'
  }
}

/**
 * Raised for a Delete whose target identity was permanently lost: `phraseId`
 * was nulled by ON DELETE SET NULL before the non-FK snapshot column existed.
 *
 * Such a pull request cannot be executed safely — any (word, code, type) lookup
 * might land on a row unrelated to the one that was reviewed — so approval
 * stops rather than guessing.
 */
export class BatchUnresolvableTargetError extends Error {
  readonly status = 409

  constructor(readonly items: Array<{ prId: number; word: string; code: string }>) {
    const detail = items
      .slice(0, 5)
      .map(item => `#${item.prId}「${item.word}」@${item.code}`)
      .join('、')
    super(
      `以下删除提议缺少目标词条记录，无法自动判定要删除哪一条，已中止审核，` +
      `请人工确认目标后重新提交：${detail}`
    )
    this.name = 'BatchUnresolvableTargetError'
  }
}

/**
 * Raised when a pull request's recorded target still exists but no longer looks
 * like what the pull request describes.
 *
 * Deliberately NOT treated as "already deleted": a silent skip would hide a real
 * inconsistency — and, for a crafted `phraseId`, would let an approval sail
 * through while quietly doing nothing.
 */
export class BatchTargetMismatchError extends Error {
  readonly status = 409

  constructor(
    readonly mismatches: Array<{ prId: number; expected: string; actual: string }>
  ) {
    const detail = mismatches
      .slice(0, 5)
      .map(item => `#${item.prId} 期望「${item.expected}」实际「${item.actual}」`)
      .join('；')
    super(`以下修改提议记录的目标词条与当前词库不一致，已中止审核：${detail}`)
    this.name = 'BatchTargetMismatchError'
  }
}

/**
 * Raised when a Change pull request cannot locate the phrase it is supposed to
 * rewrite. Previously these were silently skipped, which made an approved
 * batch claim changes it never applied.
 */
export class BatchApprovalMissingPhraseError extends Error {
  readonly status = 400

  constructor(readonly missing: Array<{ word: string; code: string; type: string }>) {
    const detail = missing
      .map(item => `「${item.word}」@${item.code}（${item.type}）`)
      .join('、')
    super(`以下待修改词条在词库中不存在，已中止审核：${detail}`)
    this.name = 'BatchApprovalMissingPhraseError'
  }
}

export function orderPullRequestsForApproval<T extends { id: number }>(
  pullRequests: T[],
  conflictResults: BatchConflictResult[]
): T[] {
  const indexById = new Map(pullRequests.map((pr, index) => [String(pr.id), index]))
  const edges = new Map<number, Set<number>>()
  const indegree = Array.from({ length: pullRequests.length }, () => 0)

  for (const result of conflictResults) {
    const dependentIndex = indexById.get(result.id)
    if (dependentIndex === undefined) continue

    for (const suggestion of result.conflict.suggestions ?? []) {
      if (suggestion.action !== 'Resolved') continue
      const resolverIndex = suggestion.resolverIndex
      if (
        resolverIndex === undefined
        || resolverIndex < 0
        || resolverIndex >= pullRequests.length
        || resolverIndex === dependentIndex
      ) {
        continue
      }

      let outgoing = edges.get(resolverIndex)
      if (!outgoing) {
        outgoing = new Set<number>()
        edges.set(resolverIndex, outgoing)
      }
      if (outgoing.has(dependentIndex)) continue

      outgoing.add(dependentIndex)
      indegree[dependentIndex] += 1
    }
  }

  if (edges.size === 0) return pullRequests

  const ready = indegree
    .map((value, index) => ({ value, index }))
    .filter(item => item.value === 0)
    .map(item => item.index)
  const orderedIndexes: number[] = []

  while (ready.length > 0) {
    const index = ready.shift()!
    orderedIndexes.push(index)

    for (const dependent of edges.get(index) ?? []) {
      indegree[dependent] -= 1
      if (indegree[dependent] === 0) {
        ready.push(dependent)
      }
    }
  }

  if (orderedIndexes.length !== pullRequests.length) {
    return pullRequests
  }

  return orderedIndexes.map(index => pullRequests[index])
}

export function classifyBatchDeleteRisk(
  pullRequests: Array<{ action: string; word: string | null; code: string | null }>
): { hasBareDelete: boolean; bareDeletes: Array<{ word: string; code: string }> } {
  const createsByWord = new Map<string, Set<string>>()
  for (const pr of pullRequests) {
    if (pr.action !== 'Create' || !pr.word || !pr.code) {
      continue
    }
    if (!createsByWord.has(pr.word)) {
      createsByWord.set(pr.word, new Set())
    }
    createsByWord.get(pr.word)!.add(pr.code)
  }

  const bareDeletes: Array<{ word: string; code: string }> = []
  for (const pr of pullRequests) {
    if (pr.action !== 'Delete' || !pr.word || !pr.code) {
      continue
    }
    const replacementCodes = createsByWord.get(pr.word)
    const isCodeMove = replacementCodes && Array.from(replacementCodes).some(code => code !== pr.code)
    if (!isCodeMove) {
      bareDeletes.push({ word: pr.word, code: pr.code })
    }
  }

  return { hasBareDelete: bareDeletes.length > 0, bareDeletes }
}

/**
 * Resolve the phrase type used to match an existing row.
 *
 * A PullRequest may have a null `type` (older rows, or bot payloads that never
 * set one). Matching with `type: undefined` would let Prisma pick *any* row
 * with the same word+code, which — now that (word, code, type) is the unique
 * key — can silently rewrite an entry in a different dictionary. Infer the
 * type instead and always match on it.
 */
function resolveMatchType(
  pr: { type: PhraseType | null; word: string | null; code: string | null; oldWord: string | null; id: number }
): { type: PhraseType; inferred: boolean } {
  if (pr.type) {
    return { type: pr.type, inferred: false }
  }
  const inferredType = detectPhraseType(pr.oldWord || pr.word || '', pr.code || undefined)
  console.warn(
    `[batchApproval] PR #${pr.id} has no type; inferred "${inferredType}" from word="${pr.oldWord || pr.word}" code="${pr.code}"`
  )
  return { type: inferredType, inferred: true }
}

export async function approveSubmittedBatch({
  batchId,
  reviewNote,
  mode = 'admin',
  allowDelete = true,
  expectedContentVersion,
  reviewerId = null,
  blockNeedsManualReview = mode === 'bot-auto',
}: ApproveSubmittedBatchOptions): Promise<ApproveSubmittedBatchResult> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      pullRequests: {
        include: {
          phrase: true,
        },
        orderBy: {
          createAt: 'asc',
        },
      },
    },
  })

  if (!batch) {
    throw new Error('批次不存在')
  }

  if (batch.status !== 'Submitted') {
    throw new Error('只能审核待审核状态的批次')
  }

  if (!allowDelete) {
    const deleteRisk = classifyBatchDeleteRisk(batch.pullRequests)
    if (deleteRisk.hasBareDelete) {
      const labels = deleteRisk.bareDeletes
        .slice(0, 5)
        .map(item => `「${item.word}」@${item.code}`)
        .join('、')
      throw new Error(`自动审核禁止纯删除项：${labels}`)
    }
  }

  const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')

  const prItems = batch.pullRequests.map((pr) => ({
    id: String(pr.id),
    action: pr.action as 'Create' | 'Change' | 'Delete',
    word: pr.word || '',
    oldWord: pr.oldWord || undefined,
    code: pr.code || '',
    type: pr.type || 'Phrase',
    weight: pr.weight || undefined,
  }))

  const conflictResults = await checkBatchConflictsWithWeight(prItems)

  const weightMap = new Map<number, number>()
  conflictResults.forEach(result => {
    const prId = parseInt(result.id)
    if (!isNaN(prId) && result.calculatedWeight !== undefined) {
      weightMap.set(prId, result.calculatedWeight)
    }
  })

  const executionOrder = orderPullRequestsForApproval(batch.pullRequests, conflictResults)

  // Everything above ran outside a transaction, against snapshots that may
  // already be stale by the time we execute. This is the fingerprint the
  // transaction below uses to prove the plan still matches reality.
  const snapshotContentVersion = batch.contentVersion
  if (
    expectedContentVersion !== undefined
    && expectedContentVersion !== snapshotContentVersion
  ) {
    throw new BatchConcurrentUpdateError()
  }
  const approvalDigest = await buildBotWarningDigest(prisma, prItems, conflictResults)

  const updated = await prisma.$transaction(async (tx) => {
    // Take the state transition first: `updateMany` with a status guard makes
    // the Submitted -> Approved move atomic, so two concurrent reviewers can
    // never both execute the same batch's pull requests.
    const transition = await tx.batch.updateMany({
      where: {
        id: batchId,
        status: 'Submitted',
        contentVersion: snapshotContentVersion,
      },
      data: {
        status: 'Approved',
        reviewNote: reviewNote || (mode === 'bot-auto' ? '本喵自动审词通过' : null),
        reviewerId: reviewerId ?? null,
        reviewedAt: new Date(),
      },
    })

    if (transition.count === 0) {
      throw new BatchConcurrentUpdateError()
    }

    // The guarded UPDATE above now holds this batch row's lock, so any
    // concurrent content mutation (which must also UPDATE this row via
    // claimBatchContentMutation) is blocked until we commit and will then fail
    // its own status guard.
    //
    // That still leaves edits that committed BEFORE this transaction opened but
    // AFTER the pre-flight snapshot was taken. `contentVersion` catches those:
    // if it moved, everything we planned from — conflict results, weights,
    // execution order — describes a batch that no longer exists.
    const locked = await tx.batch.findUniqueOrThrow({
      where: { id: batchId },
      select: { contentVersion: true },
    })

    if (locked.contentVersion !== snapshotContentVersion) {
      throw new BatchConcurrentUpdateError('批次内容已被修改，请刷新后重试')
    }

    await lockPhraseTableForWarningSnapshot(tx)
    const lockedApprovalDigest = await buildBotWarningDigest(tx, prItems, conflictResults)
    if (lockedApprovalDigest !== approvalDigest) {
      throw new BatchConcurrentUpdateError('词库内容已变化，请重新检查批次')
    }

    // Re-read the pull requests from inside the transaction and execute from
    // *these* rows, never the pre-flight snapshot. The version check above
    // should already guarantee they are identical; reading them here means that
    // even if some future write path forgets to claim the version, we can never
    // apply one thing to the dictionary while marking a different thing
    // Approved.
    const currentRows = await tx.pullRequest.findMany({
      where: { batchId },
      orderBy: { createAt: 'asc' },
    })

    const rowsById = new Map(currentRows.map(row => [row.id, row]))
    const snapshotPrIds = new Set(executionOrder.map(pr => pr.id))
    const sameSet =
      rowsById.size === snapshotPrIds.size &&
      [...rowsById.keys()].every(id => snapshotPrIds.has(id))
    if (!sameSet) {
      throw new BatchConcurrentUpdateError('批次内容已被修改，请刷新后重试')
    }

    if (blockNeedsManualReview) {
      const flaggedRows = currentRows.filter(row => row.needsManualReview)
      if (flaggedRows.length > 0) {
        throw new BatchNeedsManualReviewError(
          flaggedRows.map(row => ({ word: row.word ?? '', code: row.code ?? '' }))
        )
      }
    }

    const missingChangeTargets: Array<{ word: string; code: string; type: string }> = []
    const targetMismatches: Array<{ prId: number; expected: string; actual: string }> = []
    const unresolvableTargets: Array<{ prId: number; word: string; code: string }> = []
    // Phrases this transaction created or rewrote, for the weight uniqueness check.
    const touchedPhraseIds = new Set<number>()

    // Keep the planned ordering, but take the content from the locked re-read.
    const executionRows = executionOrder.map(pr => rowsById.get(pr.id)!)
    const verifiedTargets = new Map<number, Awaited<ReturnType<typeof tx.phrase.findUniqueOrThrow>>>()
    for (const pr of executionRows) {
      if (pr.action !== 'Change' && pr.action !== 'Delete') continue
      const targetId = pr.targetPhraseId ?? pr.phraseId
      if (!targetId || !pr.targetFingerprint) {
        throw new BatchApprovalTargetChangedError()
      }
      const target = await tx.phrase.findUnique({
        where: { id: targetId },
      })
      if (!target || createPhraseTargetFingerprint(target) !== pr.targetFingerprint) {
        throw new BatchApprovalTargetChangedError()
      }
      verifiedTargets.set(pr.id, target)
    }

    // ── Weight assignment ────────────────────────────────────────────────
    //
    // Lock every (code, type) slot this batch will write a weight into. That
    // covers Create *and* Change: a Change can carry its own weight, and both
    // occupy a slot at the code. Explicit weights are included too — they skip
    // recomputation but still need the slot serialised so the uniqueness check
    // below sees a stable picture.
    const weightSlots: PhraseWeightSlot[] = executionRows
      .filter(pr => (pr.action === 'Create' || pr.action === 'Change') && pr.code)
      .map(pr => ({ code: pr.code!, type: resolveMatchType(pr).type }))

    await lockPhraseWeightSlots(tx, weightSlots)

    // Recompute weights now that the relevant codes are locked and we are
    // reading inside the transaction. The pre-flight weights were computed
    // against a snapshot that a concurrent approval may already have invalidated.
    const lockedWeightItems: BatchPRItem[] = executionRows.map(pr => ({
      id: String(pr.id),
      action: pr.action as 'Create' | 'Change' | 'Delete',
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: (pr.type || resolveMatchType(pr).type) as PhraseType,
      weight: pr.weight ?? undefined,
    }))

    const { calculateDynamicWeight } = await import('@/lib/services/batchConflictService')
    for (let i = 0; i < executionRows.length; i++) {
      const pr = executionRows[i]
      if (pr.action !== 'Create' || !lockedWeightItems[i].type) continue
      weightMap.set(
        pr.id,
        await calculateDynamicWeight(lockedWeightItems[i], lockedWeightItems, i, tx)
      )
    }

    for (const pr of executionRows) {
      switch (pr.action) {
        case 'Create':
          if (pr.word && pr.code) {
            const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0

            const createdPhrase = await tx.phrase.create({
              data: {
                word: pr.word,
                code: pr.code,
                type: pr.type || 'Phrase',
                weight: finalWeight,
                remark: pr.remark,
                userId: pr.userId,
                status: 'Finish',
              },
              select: { id: true },
            })
            touchedPhraseIds.add(createdPhrase.id)
          }
          break

        case 'Change':
          if (pr.word) {
            const target = verifiedTargets.get(pr.id)
            if (!target) throw new BatchApprovalTargetChangedError()
            const finalWeight = weightMap.get(pr.id)
            touchedPhraseIds.add(target.id)
            await tx.phrase.update({
              where: { id: target.id },
              data: {
                word: pr.word,
                type: pr.type || undefined,
                weight: finalWeight !== undefined ? finalWeight : (pr.weight !== null ? pr.weight : undefined),
                remark: pr.remark || undefined,
              },
            })
          } else {
            // Neither a resolvable (oldWord, code, word) triple nor a phraseId:
            // there is nothing to apply, so the PR must not be silently marked
            // Approved as if it had been.
            missingChangeTargets.push({
              word: pr.oldWord || pr.word || '',
              code: pr.code || '',
              type: pr.type || 'unknown',
            })
          }
          break

        case 'Delete': {
          // A Delete authorises removing ONE specific dictionary entry: the one
          // that existed when the pull request was created. It must never be
          // redirected onto a different row that happens to occupy the same
          // (word, code, type) tuple later.
          //
          // Three distinct outcomes, deliberately not collapsed into one:
          //   - target gone            -> idempotent success
          //   - target present, matches -> delete it
          //   - target present, differs -> inconsistency, abort the batch
          const target = verifiedTargets.get(pr.id)
          if (!target) throw new BatchApprovalTargetChangedError()
          await tx.phrase.delete({ where: { id: target.id } })
          break
        }
      }

      await tx.pullRequest.update({
        where: { id: pr.id },
        data: {
          status: 'Approved',
        },
      })
    }

    if (unresolvableTargets.length > 0) {
      throw new BatchUnresolvableTargetError(unresolvableTargets)
    }

    if (targetMismatches.length > 0) {
      throw new BatchTargetMismatchError(targetMismatches)
    }

    if (missingChangeTargets.length > 0) {
      throw new BatchApprovalMissingPhraseError(missingChangeTargets)
    }

    // Still holding the (code, type) locks: verify this batch did not leave two
    // candidates sharing a weight at any slot it wrote.
    await assertNoDuplicateWeights(tx, weightSlots, touchedPhraseIds)

    return tx.batch.findUniqueOrThrow({ where: { id: batchId } })
  })

  return { batch: updated }
}
