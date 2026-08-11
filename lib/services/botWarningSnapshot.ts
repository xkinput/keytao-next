import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import { collectSkippedCandidateSlotDependencies } from './batchSkippedCodeWarnings'

interface WarningItem {
  id?: string
  action?: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord?: string
  code: string
  type?: PhraseType
  weight?: number
}

interface PhraseReader {
  phrase: Pick<Prisma.TransactionClient['phrase'], 'findMany'>
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  return value
}

export function createCanonicalDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export async function lockPhraseTableForWarningSnapshot(
  tx: Prisma.TransactionClient
): Promise<void> {
  // This must conflict with another approval taking the same snapshot lock.
  // Plain SHARE locks are mutually compatible: two approvals can both hold
  // one, then deadlock when each later tries to write phrases. SHARE ROW
  // EXCLUSIVE serializes those snapshot-and-apply transactions instead.
  await tx.$executeRawUnsafe('LOCK TABLE "phrases" IN SHARE ROW EXCLUSIVE MODE')
}

export async function buildBotWarningDigest(
  db: PhraseReader,
  items: WarningItem[],
  warningState: unknown
): Promise<string> {
  const codes = [...new Set(items.map(item => item.code))].sort()
  const words = [...new Set(items.flatMap(item => [item.word, item.oldWord].filter(Boolean) as string[]))].sort()
  const skippedSlotDependencies = await collectSkippedCandidateSlotDependencies(
    items.map((item, index) => ({
      id: item.id ?? String(index),
      action: item.action ?? 'Create',
      word: item.word,
      oldWord: item.oldWord,
      code: item.code,
      type: item.type,
      weight: item.weight,
    }))
  )
  const affectedEntities = await db.phrase.findMany({
    where: {
      OR: [
        ...(codes.length > 0 ? [{ code: { in: codes } }] : []),
        ...(words.length > 0 ? [{ word: { in: words } }] : []),
        ...skippedSlotDependencies.map(({ code }) => ({ code })),
      ],
    },
    select: { id: true, word: true, code: true, type: true, status: true, weight: true, userId: true },
    orderBy: { id: 'asc' },
  })
  return createCanonicalDigest({ items, skippedSlotDependencies, affectedEntities, warningState })
}
