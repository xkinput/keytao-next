import type { Prisma } from '@prisma/client'
import type { PhraseType } from '@/lib/constants/phraseTypes'

/**
 * Serialisation for phrase weight assignment.
 *
 * Weights are per (code, type): every candidate at a code needs a distinct
 * weight so the generated dictionary has a deterministic order. The batch row
 * cannot serialise this — two *different* batches touching the same code are
 * two different rows, so both would read `max = 100` and both assign 101.
 *
 * Transaction-scoped PostgreSQL advisory locks serialise on the (code, type)
 * pair itself. They need no schema change, are released automatically on commit
 * or rollback, and — unlike a unique constraint on (code, type, weight) —
 * cannot fail against pre-existing duplicate weights in the live dictionary.
 */

/** Namespace so these cannot collide with any other advisory lock use. */
const WEIGHT_LOCK_NAMESPACE = 0x6b74 // 'kt'

export interface PhraseWeightSlot {
  code: string
  type: PhraseType | string
}

/**
 * Stable 32-bit FNV-1a hash, mapped into the signed int4 range.
 *
 * Deliberately computed in JS rather than with PostgreSQL's `hashtext()`:
 * callers must acquire locks in a globally consistent order, and the only way
 * to guarantee that is to sort by the value actually being locked. Sorting by
 * the source string while locking by its hash lets a hash collision reverse the
 * relative order of two keys between two transactions, which deadlocks. With a
 * JS-side hash the lock id is known before locking, so it can be sorted on
 * directly; a collision then merely serialises two unrelated codes.
 */
export function weightLockId(code: string, type: PhraseType | string): number {
  const key = `${type}:${code}`
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    // FNV prime 16777619, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193)
  }
  // Force into signed int4, which is what pg_advisory_xact_lock(int, int) takes.
  return hash | 0
}

/**
 * Acquire the weight locks for every (code, type) slot this transaction will
 * write. MUST be called inside a transaction, before computing or writing any
 * weight.
 *
 * Locks are taken in ascending lock-id order so concurrent transactions with
 * overlapping slot sets can never acquire them in opposite orders.
 */
export async function lockPhraseWeightSlots(
  tx: Prisma.TransactionClient,
  slots: PhraseWeightSlot[]
): Promise<void> {
  const lockIds = Array.from(
    new Set(slots.filter(slot => slot.code).map(slot => weightLockId(slot.code, slot.type)))
  ).sort((a, b) => a - b)

  for (const lockId of lockIds) {
    // $executeRaw, not $queryRaw: the function returns void, which $queryRaw
    // cannot deserialise.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WEIGHT_LOCK_NAMESPACE}::int, ${lockId}::int)`
  }
}

export class PhraseWeightConflictError extends Error {
  readonly status = 409

  constructor(readonly collisions: Array<{ code: string; type: string; weight: number }>) {
    const detail = collisions
      .slice(0, 5)
      .map(item => `${item.code}（${item.type}）权重 ${item.weight}`)
      .join('、')
    super(`以下编码出现重复权重，无法保证候选顺序，已中止：${detail}`)
    this.name = 'PhraseWeightConflictError'
  }
}

/**
 * Verify this transaction did not introduce a duplicate weight at any slot it
 * touched.
 *
 * The advisory lock already prevents two concurrent *computed* assignments from
 * colliding, but a caller may supply an explicit weight, and two callers can
 * supply the same one. Only collisions that involve a row this transaction
 * wrote are reported, so pre-existing duplicates elsewhere in the dictionary
 * cannot block unrelated approvals.
 */
export async function assertNoDuplicateWeights(
  tx: Prisma.TransactionClient,
  slots: PhraseWeightSlot[],
  touchedPhraseIds: Iterable<number>
): Promise<void> {
  const touched = new Set(touchedPhraseIds)
  if (touched.size === 0) return

  const seen = new Set<string>()
  const collisions: Array<{ code: string; type: string; weight: number }> = []

  for (const slot of slots) {
    const slotKey = `${slot.type}:${slot.code}`
    if (!slot.code || seen.has(slotKey)) continue
    seen.add(slotKey)

    const rows = await tx.phrase.findMany({
      where: { code: slot.code, type: slot.type as PhraseType },
      select: { id: true, weight: true },
    })

    const byWeight = new Map<number, number[]>()
    for (const row of rows) {
      const ids = byWeight.get(row.weight) ?? []
      ids.push(row.id)
      byWeight.set(row.weight, ids)
    }

    for (const [weight, ids] of byWeight) {
      if (ids.length > 1 && ids.some(id => touched.has(id))) {
        collisions.push({ code: slot.code, type: String(slot.type), weight })
      }
    }
  }

  if (collisions.length > 0) {
    throw new PhraseWeightConflictError(collisions)
  }
}
