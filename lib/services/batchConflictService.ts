import { prisma } from '@/lib/prisma'
import { getDefaultWeight, type PhraseType } from '@/lib/constants/phraseTypes'
import { conflictDetector, ConflictInfo } from './conflictDetector'

// Branded types for type safety
export type CodeString = string & { readonly _brand: 'Code' }
export type WordString = string & { readonly _brand: 'Word' }

// Type guards
export const asCode = (s: string): CodeString => s as CodeString
export const asWord = (s: string): WordString => s as WordString

export interface BatchPRItem {
  id: string
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord?: string
  code: string
  weight?: number
  type?: PhraseType
}

export interface BatchConflictResult {
  id: string
  conflict: ConflictInfo
  calculatedWeight?: number
}

/**
 * Calculate dynamic weight considering batch operations before this item
 * This simulates how the word count will change after executing previous operations
 */
export async function calculateDynamicWeight(
  item: BatchPRItem,
  allItems: BatchPRItem[],
  currentIndex: number
): Promise<number> {
  if (!item.type) {
    return item.weight || 0
  }

  const baseWeight = getDefaultWeight(item.type)

  // Get current count from database
  let count = await prisma.phrase.count({
    where: { code: item.code }
  })

  // Simulate effect of previous batch operations
  for (let i = 0; i < currentIndex; i++) {
    const prev = allItems[i]
    if (prev.code !== item.code) continue

    if (prev.action === 'Create') {
      count++
    } else if (prev.action === 'Delete') {
      count--
    }
    // Change on same code doesn't change count
  }

  // Ensure count is never negative
  count = Math.max(0, count)

  return baseWeight + count
}

/**
 * Check if a later item resolves an earlier item's conflict
 * Unified logic for conflict resolution detection
 */
export function checkConflictResolution(
  resolverItem: BatchPRItem,
  conflictResult: BatchConflictResult
): { resolved: boolean; reason?: string } {
  const phrase = conflictResult.conflict.currentPhrase
  if (!phrase) {
    return { resolved: false }
  }

  // Delete resolves conflict by removing the conflicting phrase
  if (
    resolverItem.action === 'Delete' &&
    resolverItem.word === phrase.word &&
    resolverItem.code === phrase.code
  ) {
    return {
      resolved: true,
      reason: `删除了重码词 "${resolverItem.word}"`
    }
  }

  // Change resolves conflict by moving the phrase to different word
  if (
    resolverItem.action === 'Change' &&
    resolverItem.oldWord === phrase.word &&
    resolverItem.code === phrase.code
  ) {
    return {
      resolved: true,
      reason: `将 "${resolverItem.oldWord}" 修改为 "${resolverItem.word}"`
    }
  }

  return { resolved: false }
}

/**
 * Check for duplicate operations within the batch
 */
export function checkBatchDuplicates(
  items: BatchPRItem[],
  currentIndex: number
): { hasDuplicate: boolean; duplicateIndex?: number } {
  const currentItem = items[currentIndex]

  // Only check Create actions for duplicates
  if (currentItem.action !== 'Create') {
    return { hasDuplicate: false }
  }

  const currentKey = `${currentItem.code}:${currentItem.word}`

  for (let i = 0; i < currentIndex; i++) {
    const item = items[i]
    // Check if previous item creates the same word+code
    if (item.action === 'Create') {
      const key = `${item.code}:${item.word}`
      if (key === currentKey) {
        return { hasDuplicate: true, duplicateIndex: i }
      }
    }
  }

  return { hasDuplicate: false }
}

/**
 * Main batch conflict detection service
 * Handles database conflicts, batch-internal conflicts, and dynamic weight calculation
 */
export async function checkBatchConflictsWithWeight(
  items: BatchPRItem[]
): Promise<BatchConflictResult[]> {
  const results: BatchConflictResult[] = []

  // Step 1: Check each item against database and batch duplicates
  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    // Check for duplicates within batch
    const duplicateCheck = checkBatchDuplicates(items, i)
    if (duplicateCheck.hasDuplicate) {
      results.push({
        id: item.id,
        conflict: {
          hasConflict: true,
          code: item.code,
          impact: `批次内重复添加相同的词条（与修改 #${duplicateCheck.duplicateIndex! + 1} 重复）`,
          suggestions: [
            {
              action: 'Cancel',
              word: item.word,
              reason: '批次内已存在相同的词条',
            },
          ],
        },
      })
      continue
    }

    // Check against database
    const conflict = await conflictDetector.checkConflict({
      action: item.action,
      word: item.word,
      oldWord: item.oldWord,
      code: item.code,
      weight: item.weight,
    })

    // Calculate dynamic weight for Create operations
    let calculatedWeight: number | undefined
    if (item.action === 'Create' && item.type) {
      calculatedWeight = await calculateDynamicWeight(item, items, i)

      // Only override impact if there's NO conflict (重码 is allowed)
      if (conflict.currentPhrase && !conflict.hasConflict) {
        conflict.impact = `编码 "${item.code}" 已被词条 "${conflict.currentPhrase.word}" 占用，将创建重码（建议权重: ${calculatedWeight}）`
      }
    }

    results.push({
      id: item.id,
      conflict,
      calculatedWeight,
    })
  }

  // Step 2: Check if earlier operations resolve current conflicts
  // Performance optimization: Build lookup maps to avoid O(n²) complexity
  const deleteMap = new Map<string, { index: number; item: BatchPRItem }>()
  const changeMap = new Map<string, { index: number; item: BatchPRItem }>()

  // Build maps for O(1) lookup (single pass)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const key = `${item.code}:${item.word}`

    if (item.action === 'Delete') {
      deleteMap.set(key, { index: i, item })
    } else if (item.action === 'Change' && item.oldWord) {
      const changeKey = `${item.code}:${item.oldWord}`
      changeMap.set(changeKey, { index: i, item })
    }
  }

  // Check resolutions using maps (O(n) instead of O(n²))
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const phrase = result.conflict.currentPhrase

    // Skip if no current phrase (no conflict to resolve)
    if (!phrase) {
      continue
    }

    const phraseKey = `${phrase.code}:${phrase.word}`
    let resolved = false
    let resolverIndex = -1
    let reason = ''

    // Check if a Delete operation before this item resolves the conflict
    const deleteEntry = deleteMap.get(phraseKey)
    if (deleteEntry && deleteEntry.index < i) {
      resolved = true
      resolverIndex = deleteEntry.index
      reason = `删除了重码词 "${deleteEntry.item.word}"`
    }

    // Check if a Change operation before this item resolves the conflict
    if (!resolved) {
      const changeEntry = changeMap.get(phraseKey)
      if (changeEntry && changeEntry.index < i) {
        resolved = true
        resolverIndex = changeEntry.index
        reason = `将 "${changeEntry.item.oldWord}" 修改为 "${changeEntry.item.word}"`
      }
    }

    if (resolved) {
      result.conflict.hasConflict = false
      result.conflict.impact = `冲突已由批次内修改 #${resolverIndex + 1} 解决（${reason}），建议权重: ${result.calculatedWeight || '未计算'}`
      result.conflict.suggestions = [
        {
          action: 'Resolved',
          word: items[resolverIndex].word,
          reason,
        },
      ]
    }
  }

  return results
}
