import type { PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewItem } from '@/lib/types/batchAiReview'
import type { PreSubmitReviewItem, PreSubmitReviewResponse } from '@/lib/types/preSubmitReview'
import { stripMiaomiaoReviewRemark } from '@/lib/services/miaomiaoReviewRemark'

export interface PreSubmitReviewFormItem {
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord: string
  code: string
  type: string
  weight: string
  remark: string
}

export function buildPreSubmitReviewItems(
  items: PreSubmitReviewFormItem[],
  fieldIds: string[],
): PreSubmitReviewItem[] {
  return items.map((item, index) => {
    const userRemark = stripMiaomiaoReviewRemark(item.remark)
    return {
      id: fieldIds[index] ?? String(index),
      action: item.action,
      word: item.word,
      oldWord: item.action === 'Change' ? item.oldWord || undefined : undefined,
      code: item.code,
      weight: item.weight ? Number.parseInt(item.weight, 10) : undefined,
      type: item.type as PhraseType,
      remark: userRemark || undefined,
    }
  })
}

export function buildPreSubmitFingerprint(items: PreSubmitReviewItem[]): string {
  return JSON.stringify(items.map(item => ({
    id: item.id,
    action: item.action,
    word: item.word.trim(),
    oldWord: item.oldWord?.trim() || '',
    code: item.code.trim().toLowerCase(),
    type: item.type || 'Phrase',
    weight: item.weight ?? null,
    remark: item.remark?.trim() || '',
  })))
}

export function mapReviewItemsByFieldId(
  response?: PreSubmitReviewResponse,
): Map<string, BatchAiReviewItem> {
  const result = new Map<string, BatchAiReviewItem>()
  if (!response) return result

  for (const item of response.review.items) {
    const fieldId = response.reviewItemIds[String(item.prId)]
    if (fieldId) result.set(fieldId, item)
  }
  return result
}

export function formatPreSubmitReviewWarning(
  response: PreSubmitReviewResponse,
  items: PreSubmitReviewItem[],
): string {
  const issueLabels = response.review.items
    .filter(item => item.status !== 'pass')
    .slice(0, 3)
    .map(item => {
      const fieldId = response.reviewItemIds[String(item.prId)]
      const index = items.findIndex(candidate => candidate.id === fieldId)
      return `#${index >= 0 ? index + 1 : item.prId} ${item.title}`
    })
  const sourceNote = response.reviewSource === 'bot_llm'
    ? '本喵结论：该批次可提交，但需管理员确认。'
    : `完整审词暂未完成${response.reviewError ? `：${response.reviewError}` : ''}；该批次可提交，但需管理员审核。`

  return [
    '▶ 喵喵提交前审词：',
    `   ${response.review.headline}`,
    issueLabels.length > 0 ? `   关注：${issueLabels.join('；')}` : '',
    `   ! ${sourceNote}`,
  ].filter(Boolean).join('\n')
}
