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

  // For Create action, check if this word+code already exists in database
  // If it exists, return its current weight
  if (item.action === 'Create') {
    const existingPhrase = await prisma.phrase.findFirst({
      where: {
        word: item.word,
        code: item.code
      },
      select: { weight: true }
    })

    if (existingPhrase) {
      // Word+code combination already exists, use its weight
      return existingPhrase.weight
    }
  }

  const baseWeight = getDefaultWeight(item.type)

  // Get all existing phrases with their weights for this code
  const existingPhrases = await prisma.phrase.findMany({
    where: { code: item.code },
    select: { word: true, weight: true }
  })

  // Track occupied weights (simulate batch operations)
  const occupiedWeights = new Set<number>(existingPhrases.map(p => p.weight))
  const wordToWeight = new Map<string, number>(existingPhrases.map(p => [p.word, p.weight]))

  // Simulate batch operations:
  // - Previous Creates: add their calculated weights (progressive)
  // - ALL Deletes: remove their weights
  // - Changes: no effect
  for (let i = 0; i < allItems.length; i++) {
    if (i === currentIndex) continue

    const other = allItems[i]
    if (other.code !== item.code) continue

    if (other.action === 'Create' && i < currentIndex) {
      // Previous Create: if it's a new word, it will occupy baseWeight + currentSize
      if (!wordToWeight.has(other.word)) {
        // Calculate what weight this previous Create will get
        const prevMaxWeight = occupiedWeights.size > 0 ? Math.max(...occupiedWeights) : baseWeight - 1
        occupiedWeights.add(prevMaxWeight + 1)
      }
    } else if (other.action === 'Delete') {
      // Delete frees up its weight
      const weight = wordToWeight.get(other.word)
      if (weight !== undefined) {
        occupiedWeights.delete(weight)
      }
    }
  }

  // Append to the end: max weight + 1
  if (occupiedWeights.size === 0) {
    return baseWeight
  }

  return Math.max(...occupiedWeights) + 1
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

  // Step 2: Check if other operations in batch resolve current conflicts
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
    const currentItem = items[i]
    const phrase = result.conflict.currentPhrase

    // Skip if no current phrase (no conflict to resolve)
    if (!phrase) {
      continue
    }

    const phraseKey = `${phrase.code}:${phrase.word}`
    let resolved = false
    let resolverIndex = -1
    let reason = ''
    let timing = ''

    // Check if a Delete operation resolves the conflict (before OR after)
    const deleteEntry = deleteMap.get(phraseKey)
    if (deleteEntry && deleteEntry.index !== i) {
      resolved = true
      resolverIndex = deleteEntry.index
      reason = `删除了占用词 "${deleteEntry.item.word}"`
      timing = resolverIndex < i ? '已' : '将在'
    }

    // Check if a Change operation resolves the conflict (before OR after)
    if (!resolved) {
      const changeEntry = changeMap.get(phraseKey)
      if (changeEntry && changeEntry.index !== i) {
        // For Create operations with Change on same phrase:
        // This ALWAYS creates duplicate code (重码), never resolves conflict
        // Example: DB has "原词"@"code1", Change "原词"→"新词", Create "原词"@"code1"
        // Result: code1 has both "新词" (changed) and "原词" (created) = 重码
        if (currentItem.action === 'Create') {
          // Change modifies the existing phrase to a different word
          // Create will add a new phrase (even with same word name)
          // Result: code has multiple words = 重码
          const finalWord = changeEntry.item.word
          result.conflict.impact = `编码 "${currentItem.code}" 已被词条 "${finalWord}" 占用，将创建重码（建议权重: ${result.calculatedWeight || '未计算'}）`

          // Update currentPhrase to reflect the batch state (after Change)
          if (result.conflict.currentPhrase) {
            result.conflict.currentPhrase = {
              ...result.conflict.currentPhrase,
              word: finalWord,
            }
          }

          // Update suggestions to reflect batch context
          result.conflict.suggestions = [
            {
              action: 'Cancel',
              word: currentItem.word,
              reason: `批次执行后，编码 "${currentItem.code}" 将被 "${finalWord}" 占用，创建此词将形成重码`,
            },
          ]

          resolved = false
        } else {
          // For Delete or Change operations, Change can resolve conflicts
          resolved = true
          resolverIndex = changeEntry.index
          reason = `将 "${changeEntry.item.oldWord}" 修改为 "${changeEntry.item.word}"`
          timing = resolverIndex < i ? '已' : '将在'
        }
      }
    }

    if (resolved) {
      result.conflict.hasConflict = false
      result.conflict.impact = `${timing}批次内第 ${resolverIndex + 1} 个操作中${reason}，建议权重: ${result.calculatedWeight || '未计算'}`
      result.conflict.suggestions = [
        {
          action: 'Resolved',
          word: items[resolverIndex].word,
          reason: `${timing}第 ${resolverIndex + 1} 个操作中${reason}`,
        },
      ]
    }
  }

  return results
}
