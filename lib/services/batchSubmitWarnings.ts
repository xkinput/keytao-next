import type { BatchPRItem } from './batchConflictService'

interface BatchSubmitWarningConflictResult {
  id: string
  conflict: {
    code: string
    currentPhrase?: {
      word: string
      weight: number
    }
    impact?: string
    suggestions?: Array<{ action: string }>
  }
}

export interface BatchSubmitWarning {
  id: string
  word: string
  code: string
  weight: number
  impact?: string
}

export function buildBatchSubmitWarnings(
  items: BatchPRItem[],
  results: BatchSubmitWarningConflictResult[]
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
      id: result.id,
      word: result.conflict.currentPhrase!.word,
      code: result.conflict.code,
      weight: result.conflict.currentPhrase!.weight,
      impact: result.conflict.impact,
    }))
}

export function formatBatchSubmitWarnings(
  warnings: BatchSubmitWarning[],
  items: BatchPRItem[]
): string[] {
  return warnings.map((warning, fallbackIndex) => {
    const itemIndex = items.findIndex(item => item.id === warning.id)
    const item = itemIndex >= 0 ? items[itemIndex] : undefined
    const displayIndex = itemIndex >= 0 ? itemIndex + 1 : fallbackIndex + 1
    const title = item?.action === 'Change' ? '修改重码/多编码警告' : '创建重码/多编码警告'
    const requested = item ? `   请求词条: ${item.word} @ ${item.code}\n` : ''
    const detail = warning.impact || `编码 "${warning.code}" 已被词条 "${warning.word}" 占用（权重: ${warning.weight}）`

    return `▶ 项目 #${displayIndex} - ${title}:\n` +
      requested +
      `   ${detail}\n` +
      `   ! 确认后将按批次净效果提交。`
  })
}
