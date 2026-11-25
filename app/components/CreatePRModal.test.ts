import { expect, it } from 'vitest'
import { buildEditFormItem } from './CreatePRModal'
import { MIAOMIAO_REVIEW_BLOCK_END, MIAOMIAO_REVIEW_BLOCK_START } from '@/lib/services/miaomiaoReviewRemark'

it('loads only the author remark into the editable item', () => {
  const item = { id: 1, action: 'Create', word: '试词', code: 'ceui' } as const
  const reviewBlock = `${MIAOMIAO_REVIEW_BLOCK_START}\n本喵复审：需复核\n${MIAOMIAO_REVIEW_BLOCK_END}`
  expect(buildEditFormItem({ ...item, remark: `作者备注\n\n${reviewBlock}` }).remark).toBe('作者备注')
  expect(buildEditFormItem({ ...item, remark: reviewBlock }).remark).toBe('')
})
