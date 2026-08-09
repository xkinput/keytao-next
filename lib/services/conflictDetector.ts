import { prisma } from '@/lib/prisma'
import { PullRequestType, PhraseType } from '@prisma/client'
import { hasHigherPriorityWeight } from '@/lib/constants/phraseTypes'
import {
  appendCodeWithinMaxLength,
  getCodeValidationError,
} from '@/lib/constants/codeValidation'

export interface PhraseChange {
  action: PullRequestType
  word: string
  oldWord?: string // For Change action: the old word to be replaced
  code: string
  type?: PhraseType
  phraseId?: number
  weight?: number
}

export interface ConflictInfo {
  hasConflict: boolean
  code: string
  currentPhrase?: {
    id: number
    word: string
    code: string
    weight: number
    userId: number
    type?: PhraseType
  }
  impact?: string
  suggestions: CodeSuggestion[]
}

export interface CodeSuggestion {
  action: 'Move' | 'Adjust' | 'Cancel' | 'Resolved'
  word: string
  fromCode?: string
  toCode?: string
  reason: string
  resolverIndex?: number  // Index of the resolver PR in the batch items array
}

/**
 * Generate alternative codes based on input method logic.
 */
export function generateAlternativeCodes(code: string, type?: PhraseType): string[] {
  const alternatives: string[] = []
  const commonSuffixes = ['a', 'i', 'o', 'u', 'v']

  for (const suffix of commonSuffixes) {
    const alternative = appendCodeWithinMaxLength(code, suffix, type)
    if (alternative) alternatives.push(alternative)
  }

  if (code.length > 0) {
    const lastChar = code[code.length - 1]
    const alternative = appendCodeWithinMaxLength(code, lastChar, type)
    if (alternative) alternatives.push(alternative)
  }

  return alternatives
}

export class ConflictDetector {
  /**
   * Check if a phrase change will cause conflicts
   *
   * Phrase uniqueness is (word, code, type), so every lookup below is scoped by
   * `change.type`. Callers must pass the type whenever they know it — omitting
   * it widens the query to every dictionary and produces phantom conflicts for
   * combinations the schema now allows (same word+code under a different type).
   * `undefined` is kept as the "search every type" escape hatch for callers
   * that genuinely have no type information.
   */
  async checkConflict(change: PhraseChange): Promise<ConflictInfo> {
    const effectiveType = change.type || undefined

    // For Change action, verify old phrase exists
    if (change.action === 'Change') {
      if (!change.oldWord) {
        return {
          hasConflict: true,
          code: change.code,
          impact: '修改操作需要指定旧词',
          suggestions: [{
            action: 'Cancel',
            word: change.word,
            reason: '请指定要修改的旧词'
          }]
        }
      }

      const oldPhrase = await prisma.phrase.findFirst({
        where: {
          word: change.oldWord,
          code: change.code,
          type: effectiveType
        }
      })

      if (!oldPhrase) {
        return {
          hasConflict: true,
          code: change.code,
          impact: `编码 "${change.code}" 下不存在词 "${change.oldWord}"，无法修改`,
          suggestions: [{
            action: 'Cancel',
            word: change.word,
            reason: '旧词不存在，请检查编码和旧词是否正确'
          }]
        }
      }

      // Check if new word already exists for this code
      if (change.word !== change.oldWord) {
        const newWordExists = await prisma.phrase.findFirst({
          where: {
            word: change.word,
            code: change.code,
            type: effectiveType
          }
        })

        if (newWordExists) {
          return {
            hasConflict: true,
            code: change.code,
            currentPhrase: {
              id: newWordExists.id,
              word: newWordExists.word,
              code: newWordExists.code,
              weight: newWordExists.weight,
              userId: newWordExists.userId,
              type: newWordExists.type
            },
            impact: `编码 "${change.code}" 下已存在词 "${change.word}"`,
            suggestions: [{
              action: 'Cancel',
              word: change.word,
              reason: '目标词已存在该编码下，会产生重复'
            }]
          }
        }
      }

      // No conflict for Change action
      return {
        hasConflict: false,
        code: change.code,
        currentPhrase: {
          id: oldPhrase.id,
          word: oldPhrase.word,
          code: oldPhrase.code,
          weight: oldPhrase.weight,
          userId: oldPhrase.userId,
          type: oldPhrase.type
        },
        suggestions: []
      }
    }

    // For Delete action, verify phrase exists
    if (change.action === 'Delete') {
      const phraseToDelete = await prisma.phrase.findFirst({
        where: {
          word: change.word,
          code: change.code,
          type: effectiveType
        }
      })

      if (!phraseToDelete) {
        return {
          hasConflict: true,
          code: change.code,
          impact: `词条 "${change.word}" (编码: ${change.code}) 不存在，无法删除`,
          suggestions: [{
            action: 'Cancel',
            word: change.word,
            reason: '该词条在字典中不存在，请检查词和编码是否正确'
          }]
        }
      }

      // Phrase exists, can be deleted
      return {
        hasConflict: false,
        code: change.code,
        currentPhrase: {
          id: phraseToDelete.id,
          word: phraseToDelete.word,
          code: phraseToDelete.code,
          weight: phraseToDelete.weight,
          userId: phraseToDelete.userId,
          type: phraseToDelete.type
        },
        suggestions: []
      }
    }

    // For Create action, check if code is already occupied
    // First: Check if exact word+code combination already exists
    const exactMatch = await prisma.phrase.findFirst({
      where: {
        word: change.word,
        code: change.code,
        type: effectiveType,
        NOT: change.phraseId ? { id: change.phraseId } : undefined
      }
    })

    if (exactMatch) {
      // Exact word+code combination already exists - this is NOT allowed
      return {
        hasConflict: true,
        code: change.code,
        currentPhrase: {
          id: exactMatch.id,
          word: exactMatch.word,
          code: exactMatch.code,
          weight: exactMatch.weight,
          userId: exactMatch.userId,
          type: exactMatch.type
        },
        impact: `词条 "${change.word}" 与编码 "${change.code}" 的组合已存在，不能重复添加`,
        suggestions: [{
          action: 'Cancel',
          word: change.word,
          reason: '该词条和编码的组合已在字典中存在'
        }]
      }
    }

    // Second: Check if code exists with different word (重码)
    // Third: Check if word exists with different code (多编码词)
    const [existingCode, existingWord] = await Promise.all([
      prisma.phrase.findFirst({
        where: {
          code: change.code,
          type: effectiveType,
          NOT: change.phraseId ? { id: change.phraseId } : undefined
        },
        include: {
          user: {
            select: { id: true, name: true }
          }
        }
      }),
      prisma.phrase.findFirst({
        where: {
          word: change.word,
          code: { not: change.code },
          type: effectiveType,
          NOT: change.phraseId ? { id: change.phraseId } : undefined
        },
        select: {
          id: true,
          word: true,
          code: true,
          weight: true,
          userId: true,
          type: true
        }
      })
    ])

    if (!existingCode && !existingWord) {
      return {
        hasConflict: false,
        code: change.code,
        suggestions: []
      }
    }

    if (existingCode) {
      // Code exists with different word - this creates a duplicate code (重码)
      // Allow creation but provide warning via currentPhrase
      const suggestions = await this.generateSuggestions(change, existingCode)
      const extraWarning = existingWord
        ? `；词条 "${change.word}" 已存在于编码 "${existingWord.code}"`
        : ''

      return {
        hasConflict: false, // Allow creation, let user confirm
        code: change.code,
        currentPhrase: {
          id: existingCode.id,
          word: existingCode.word,
          code: existingCode.code,
          weight: existingCode.weight,
          userId: existingCode.userId,
          type: existingCode.type
        },
        impact: `编码 "${change.code}" 已被词条 "${existingCode.word}" 占用，将创建重码${extraWarning}`,
        suggestions
      }
    }

    // Word exists with different code - warn but allow
    return {
      hasConflict: false,
      code: change.code,
      currentPhrase: {
        id: existingWord!.id,
        word: existingWord!.word,
        code: existingWord!.code,
        weight: existingWord!.weight,
        userId: existingWord!.userId,
        type: existingWord!.type
      },
      impact: `词条 "${change.word}" 已存在于编码 "${existingWord!.code}"，将创建多编码词条`,
      suggestions: []
    }
  }

  /**
   * Generate suggestions to resolve conflicts
   */
  private async generateSuggestions(
    proposed: PhraseChange,
    existing: { id: number; word: string; code: string; weight: number; userId: number; type?: PhraseType }
  ): Promise<CodeSuggestion[]> {
    const suggestions: CodeSuggestion[] = []

    // Suggestion 1: Move existing phrase to alternative code
    const alternativeCodes = generateAlternativeCodes(existing.code, existing.type)
    for (const altCode of alternativeCodes) {
      const isAvailable = await this.isCodeAvailable(altCode, existing.type)
      if (isAvailable) {
        this.pushSuggestion(suggestions, {
          action: 'Move',
          word: existing.word,
          fromCode: existing.code,
          toCode: altCode,
          reason: `将 "${existing.word}" 移动到次选编码 "${altCode}"`
        }, existing.type)
        break // Only suggest one alternative
      }
    }

    // Suggestion 2: Use alternative code for proposed word
    const proposedAlts = generateAlternativeCodes(proposed.code, proposed.type)
    for (const altCode of proposedAlts) {
      const isAvailable = await this.isCodeAvailable(altCode, proposed.type)
      if (isAvailable) {
        this.pushSuggestion(suggestions, {
          action: 'Adjust',
          word: proposed.word,
          fromCode: proposed.code,
          toCode: altCode,
          reason: `使用次选编码 "${altCode}" 替代`
        }, proposed.type)
        break
      }
    }

    // Suggestion 3: Cancel if proposed has lower priority
    if (
      proposed.weight !== undefined
      && hasHigherPriorityWeight(existing.weight, proposed.weight)
    ) {
      suggestions.push({
        action: 'Cancel',
        word: proposed.word,
        reason: `现有词条 "${existing.word}" 权重更低、优先级更高，建议取消修改`
      })
    }

    return suggestions
  }

  /**
   * Keep invalid generated codes out of suggestion payloads even if a future
   * generator bypasses the length-aware append helper.
   */
  private pushSuggestion(
    suggestions: CodeSuggestion[],
    suggestion: CodeSuggestion,
    type?: PhraseType
  ): void {
    if (suggestion.toCode) {
      const validationError = getCodeValidationError(suggestion.toCode, type)
      if (validationError) {
        console.warn('[conflictDetector] Dropped invalid code suggestion', {
          action: suggestion.action,
          code: suggestion.toCode,
          type: type ?? null,
          validationError,
        })
        return
      }
    }
    suggestions.push(suggestion)
  }

  /**
   * Check if a code is available
   */
  private async isCodeAvailable(code: string, type?: PhraseType): Promise<boolean> {
    const existing = await prisma.phrase.findFirst({
      where: { code, type: type || undefined }
    })
    return !existing
  }

  /**
   * Validate a batch of changes
   */
  async validateBatch(changes: PhraseChange[]): Promise<{
    valid: boolean
    conflicts: ConflictInfo[]
    unresolvedConflicts: ConflictInfo[]
  }> {
    const conflicts: ConflictInfo[] = []
    const codeMap = new Map<string, PhraseChange>()

    // Build code map from changes
    for (const change of changes) {
      if (change.action !== 'Delete') {
        codeMap.set(change.code, change)
      }
    }

    // Check each change for conflicts
    for (const change of changes) {
      const conflict = await this.checkConflict(change)
      if (conflict.hasConflict) {
        conflicts.push(conflict)
      }
    }

    // Check if conflicts are resolved within the batch
    const unresolvedConflicts = conflicts.filter((conflict) => {
      // For Delete action: if hasConflict=true and no currentPhrase, it means phrase doesn't exist
      if (!conflict.currentPhrase) {
        return true // Always unresolved if phrase doesn't exist for deletion
      }

      // Check if the conflicting phrase is being moved in this batch
      const isResolved = changes.some(
        (change) =>
          change.phraseId === conflict.currentPhrase!.id &&
          (change.action === 'Delete' ||
            (change.action === 'Change' && change.code !== conflict.code))
      )

      return !isResolved
    })

    return {
      valid: unresolvedConflicts.length === 0,
      conflicts,
      unresolvedConflicts
    }
  }

  /**
   * Create dependency relationship between PRs
   */
  createDependency(
    dependentId: number,
    dependsOnId: number,
    reason: string
  ) {
    return prisma.pullRequestDependency.create({
      data: {
        dependentId,
        dependsOnId,
        reason
      }
    })
  }
}

// Singleton instance
export const conflictDetector = new ConflictDetector()
