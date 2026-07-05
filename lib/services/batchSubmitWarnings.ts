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
  weight?: number
  impact?: string
  warningType?: 'duplicate_code' | 'multiple_code' | 'skipped_candidate_slot' | 'code_chain_priority'
  skippedCode?: string
  skippedCodes?: string[]
  comparedWord?: string
  previousWord?: string
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
    if (warning.warningType === 'skipped_candidate_slot') {
      const skippedCode = warning.skippedCode || warning.skippedCodes?.[0] || ''
      const requested = item ? `   请求词条: ${item.word} @ ${item.code}\n` : ''
      const detail = warning.impact ||
        `编码链中更短候选 "${skippedCode}" 仍是空位，不建议直接跳到更长编码 "${warning.code}"。`

      return `▶ 项目 #${displayIndex} - 跳过编码空位警告:\n` +
        requested +
        `   ${detail}\n` +
        `   ! 请确认是否要跳过编码 ${skippedCode} 直接继续。`
    }

    if (warning.warningType === 'code_chain_priority') {
      const requested = item ? `   请求词条: ${item.word} @ ${item.code}\n` : ''
      const detail = warning.impact ||
        `「${warning.word}」将占用编码 "${warning.code}" 的更前位置，请确认它是否比当前同码链词条更适合。`

      return `▶ 项目 #${displayIndex} - 同码链优先级确认:\n` +
        requested +
        `   ${detail}\n` +
        `   ! 确认后才会提交审核。`
    }

    const title = item?.action === 'Change' ? '修改重码/多编码警告' : '创建重码/多编码警告'
    const requested = item ? `   请求词条: ${item.word} @ ${item.code}\n` : ''
    const detail = warning.impact || `编码 "${warning.code}" 已被词条 "${warning.word}" 占用（权重: ${warning.weight}）`

    return `▶ 项目 #${displayIndex} - ${title}:\n` +
      requested +
      `   ${detail}\n` +
      `   ! 确认后将按批次净效果提交。`
  })
}
