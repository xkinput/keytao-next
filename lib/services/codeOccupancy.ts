import { prisma } from '@/lib/prisma'

export interface CodeOccupancyEntry {
  code: string
}

export type CrossTypeCodeOccupancyCounts = Map<string, number>

/**
 * Input-code occupancy is cross-type because every generated dictionary is
 * loaded into the same input space: one entry at a code occupies that code for
 * every phrase type. Dictionary-local identity, weight uniqueness, and chain
 * ordering are different questions and must remain scoped by `(type, code)`.
 */
export function normalizeCrossTypeCode(code: string): string {
  return code.trim().toLowerCase()
}

export function groupEntriesByCodeAcrossTypes<T extends CodeOccupancyEntry>(
  entries: Iterable<T>
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const entry of entries) {
    const code = normalizeCrossTypeCode(entry.code)
    if (!code) continue
    const group = groups.get(code) ?? []
    group.push(entry)
    groups.set(code, group)
  }
  return groups
}

export function buildCrossTypeCodeOccupancyCounts(
  entries: Iterable<CodeOccupancyEntry>
): CrossTypeCodeOccupancyCounts {
  const counts: CrossTypeCodeOccupancyCounts = new Map()
  for (const [code, group] of groupEntriesByCodeAcrossTypes(entries)) {
    counts.set(code, group.length)
  }
  return counts
}

export function adjustCrossTypeCodeOccupancyCount(
  counts: CrossTypeCodeOccupancyCounts,
  code: string,
  delta: number
): void {
  const normalizedCode = normalizeCrossTypeCode(code)
  if (!normalizedCode) return
  counts.set(normalizedCode, (counts.get(normalizedCode) ?? 0) + delta)
}

export function isCodeOccupiedAcrossTypes(
  counts: ReadonlyMap<string, number>,
  code: string
): boolean {
  return (counts.get(normalizeCrossTypeCode(code)) ?? 0) > 0
}

export async function isCodeAvailableAcrossTypes(code: string): Promise<boolean> {
  const existing = await prisma.phrase.findFirst({
    where: { code: normalizeCrossTypeCode(code) },
    select: { id: true },
  })
  return existing === null
}
