import type { BatchConflictResult, BatchPRItem } from './batchConflictService'

export interface BatchSubmitWarning {
  word: string
  code: string
  weight: number
  impact?: string
}

export function buildBatchSubmitWarnings(
  items: BatchPRItem[],
  results: BatchConflictResult[]
): BatchSubmitWarning[] {
  return results
    .filter((result, index) => {
      const item = items[index]
      if (!item || item.action === 'Delete') return false

      const isResolved = result.conflict.suggestions?.some(suggestion => suggestion.action === 'Resolved')
      if (isResolved || !result.conflict.currentPhrase) return false

      const isChangeOldWord = item.action === 'Change' &&
        result.conflict.currentPhrase.word === item.oldWord

      return !isChangeOldWord
    })
    .map(result => ({
      word: result.conflict.currentPhrase!.word,
      code: result.conflict.code,
      weight: result.conflict.currentPhrase!.weight,
      impact: result.conflict.impact,
    }))
}