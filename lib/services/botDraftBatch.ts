import type { Prisma } from '@prisma/client'

/**
 * Bot-created batches are namespaced by their description prefix.
 * Every "the user's bot draft" query must filter on this prefix so that
 * batches created from the web UI are never picked up by bot endpoints.
 */
export const BOT_BATCH_DESCRIPTION_PREFIX = '键道助手'
export const BOT_DRAFT_BATCH_DESCRIPTION = '键道助手草稿批次'

/**
 * Digest identity for "the draft batch that does not exist yet".
 *
 * A write that has to create the user's first draft cannot name a real batch
 * id, and the provisional id handed out by a preview is a fresh UUID on every
 * call. Feeding that UUID into the warning digest would make the digest
 * unreproducible, so preview and confirm could never agree. Both phases
 * therefore use this constant as the batch identity whenever the target batch
 * does not exist yet; the moment a real batch exists, its id is used again.
 *
 * The corresponding CAS baseline is `expectedContentVersion: 0` with no
 * `batchId`, i.e. "I expect this user to have no bot draft at all". It is
 * re-checked inside the write transaction by `assertNoBotDraftBatch`.
 */
export const NEW_BOT_DRAFT_BATCH_IDENTITY = 'new-bot-draft-batch'

/** Minimal client shape shared by `prisma` and a transaction client. */
export interface BotDraftBatchClient {
  batch: Pick<Prisma.TransactionClient['batch'], 'findFirst'>
}

export interface CurrentBotDraftBatch {
  id: string
  description: string | null
  createAt: Date
  contentVersion: number
  pullRequestCount: number
}

export function botDraftBatchWhere(userId: number): Prisma.BatchWhereInput {
  return {
    creatorId: userId,
    status: 'Draft',
    description: { startsWith: BOT_BATCH_DESCRIPTION_PREFIX },
  }
}

const CURRENT_DRAFT_SELECT = {
  id: true,
  description: true,
  createAt: true,
  contentVersion: true,
  _count: { select: { pullRequests: true } },
} satisfies Prisma.BatchSelect

type CurrentDraftRow = {
  id: string
  description: string | null
  createAt: Date
  contentVersion: number
  _count: { pullRequests: number }
}

function toCurrentBotDraftBatch(row: CurrentDraftRow): CurrentBotDraftBatch {
  return {
    id: row.id,
    description: row.description,
    createAt: row.createAt,
    contentVersion: row.contentVersion,
    pullRequestCount: row._count.pullRequests,
  }
}

/**
 * The single definition of "the user's current bot draft batch".
 *
 * Selection rule: a draft that already holds content wins over an empty one;
 * only when no draft holds content do we fall back to the newest empty draft.
 *
 * Why not plain `createAt desc`: a batch that was recalled from review keeps
 * its original `createAt`, so any draft created after the submission (for
 * instance by a stray write, or historically by the read path's old
 * get-or-create behaviour) would shadow it and make its items invisible to
 * every "current draft" reader. That is exactly how batch 785e0368's items were
 * lost behind the empty ec511ac6.
 *
 * The rule is unambiguous in practice because
 * `assertNoOtherBotDraftWithContent` already enforces that at most one bot
 * draft per user carries content; the `createAt desc` ordering is only a
 * deterministic tie-break for legacy data that predates that invariant.
 *
 * This function never creates anything: reading the current draft must not
 * change which batch the pointer designates.
 */
export async function findCurrentBotDraftBatch(
  client: BotDraftBatchClient,
  userId: number
): Promise<CurrentBotDraftBatch | null> {
  const withContent = await client.batch.findFirst({
    where: { ...botDraftBatchWhere(userId), pullRequests: { some: {} } },
    orderBy: { createAt: 'desc' },
    select: CURRENT_DRAFT_SELECT,
  })
  if (withContent) return toCurrentBotDraftBatch(withContent)

  const newestEmpty = await client.batch.findFirst({
    where: botDraftBatchWhere(userId),
    orderBy: { createAt: 'desc' },
    select: CURRENT_DRAFT_SELECT,
  })
  return newestEmpty ? toCurrentBotDraftBatch(newestEmpty) : null
}

/** Convenience wrapper for callers that only need the batch id. */
export async function findCurrentBotDraftBatchId(
  client: BotDraftBatchClient,
  userId: number
): Promise<string | null> {
  const batch = await findCurrentBotDraftBatch(client, userId)
  return batch?.id ?? null
}
