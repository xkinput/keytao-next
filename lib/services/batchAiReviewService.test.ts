import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  phraseFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    phrase: { findMany: mocks.phraseFindMany },
  },
}))

import { buildBatchAiReview } from './batchAiReviewService'

async function reviewRemark(remark: string) {
  const review = await buildBatchAiReview({
    id: 'batch-1',
    status: 'Submitted',
    pullRequests: [{
      id: 1,
      action: 'Create',
      word: '蟹棒',
      code: 'xplh',
      type: 'Phrase',
      weight: 100,
      remark,
    }],
  })
  return review.items[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.phraseFindMany.mockResolvedValue([])
})

describe('batch AI review remark evidence', () => {
  it.each([
    ['plain context without parentheses', '本喵语境判断'],
    ['plain context with parentheses', '本喵语境判断（常见词）'],
    ['entity context without parentheses', '本喵实体语境判断'],
    ['entity context with parentheses', '本喵实体语境判断（常见词，暂无权威页）'],
    ['whole-word context without parentheses', '本喵整词语境判断'],
    ['whole-word context with parentheses', '本喵整词语境判断(常见词，暂无权威整词页)'],
    ['encyclopedia entity context without parentheses', '百科实体全称语境'],
    ['encyclopedia entity context with parentheses', '百科实体全称语境（蟹肉棒，暂无独立读音页）'],
  ])('accepts %s as a common-sense source distinct from authority sources', async (_label, source) => {
    const item = await reviewRemark(
      `喵喵审词：读音 xie bang；来源 ${source}；自动审核：该词可自动通过（本喵识别为常见词（蟹棒 / 蟹肉棒 / 蟹柳），编码在候选链中）`,
    )

    expect(item.reviewRecord).toMatchObject({
      sources: [source],
      authoritySources: [],
      commonSenseSources: [source],
    })
    expect(item.reasons).not.toContain('有喵喵审词记录，但没有识别到来源名称或常识判断说明。')
  })

  it('accepts the exact bare whole-word context remark without raising the missing-source warning', async () => {
    const item = await reviewRemark(
      '喵喵审词：读音 xun cha；来源 本喵整词语境判断；自动审核：该词需管理员审核',
    )

    expect(item.reviewRecord?.commonSenseSources).toEqual(['本喵整词语境判断'])
    expect(item.reasons).not.toContain('有喵喵审词记录，但没有识别到来源名称或常识判断说明。')
  })

  it('accepts explicit language-common-sense evidence when the structured source list is empty', async () => {
    const item = await reviewRemark([
      '--- miao-review:start ---',
      '本喵复审：通过',
      '结论：常见词读音与编码一致',
      '理由：蟹棒是大众通行的食品名称。',
      '建议：可以批准。',
      '读音：xie bang',
      '证据：本喵语言常识：蟹棒即蟹肉棒，大众通行。',
      '--- miao-review:end ---',
    ].join('\n'))

    expect(item.reviewRecord).toMatchObject({
      sources: [],
      authoritySources: [],
      commonSenseSources: ['语言常识'],
    })
    expect(item.status).toBe('pass')
  })

  it('accepts language common sense only in an explicit legacy source position', async () => {
    const supported = await reviewRemark(
      '喵喵审词：读音 xie bang；来源 语言常识；自动审核：该词可自动通过',
    )
    const denied = await reviewRemark(
      '喵喵审词：读音 xie bang；本词违反语言常识，建议管理员复核',
    )

    expect(supported.reviewRecord?.commonSenseSources).toEqual(['语言常识'])
    expect(denied.reviewRecord?.commonSenseSources).toEqual([])
  })

  it('does not treat structured evidence that denies language common sense as support', async () => {
    const item = await reviewRemark([
      '--- miao-review:start ---',
      '本喵复审：需人工确认',
      '结论：缺少可靠依据',
      '读音：xie bang',
      '来源：',
      '证据：本词违反语言常识，建议管理员复核。',
      '--- miao-review:end ---',
    ].join('\n'))

    expect(item.reviewRecord?.commonSenseSources).toEqual([])
  })

  it('uses the authority whitelist consistently for structured and legacy sources', async () => {
    const structuredFake = await reviewRemark([
      '--- miao-review:start ---',
      '本喵复审：需人工确认',
      '结论：来源待核验',
      '读音：xie bang',
      '来源：胡编乱造的来源',
      '--- miao-review:end ---',
    ].join('\n'))
    const legacyFake = await reviewRemark('喵喵审词：读音 xie bang；来源 胡编乱造的来源')
    const structuredNamed = await reviewRemark([
      '--- miao-review:start ---',
      '本喵复审：通过',
      '结论：来源已核验',
      '读音：xie bang',
      '来源：汉典词条',
      '--- miao-review:end ---',
    ].join('\n'))
    const legacyNamed = await reviewRemark('喵喵审词：读音 xie bang；来源 汉典词条')

    expect(structuredFake.reviewRecord?.authoritySources).toEqual([])
    expect(legacyFake.reviewRecord?.authoritySources).toEqual([])
    expect(structuredNamed.reviewRecord?.authoritySources).toEqual(['汉典'])
    expect(legacyNamed.reviewRecord?.authoritySources).toEqual(['汉典'])
  })

  it('keeps legacy authority evidence when a later structured re-review returns no sources', async () => {
    const item = await reviewRemark([
      '喵喵审词：读音 an bo；来源 汉典',
      '',
      '--- miao-review:start ---',
      '本喵复审：通过',
      '结论：读音与编码一致',
      '理由：复审未发现冲突。',
      '建议：可以批准。',
      '读音：an bo',
      '--- miao-review:end ---',
    ].join('\n'))

    expect(item.reviewRecord).toMatchObject({
      source: 'bot-llm',
      pronunciation: 'an bo',
      sources: ['汉典'],
      authoritySources: ['汉典'],
      commonSenseSources: [],
    })
    expect(item.reviewRecord?.evidence).toContain('来源：汉典')
  })

  it('retracts legacy authority evidence when a structured re-review emits an empty source field', async () => {
    const item = await reviewRemark([
      '喵喵审词：读音 an bo；来源 汉典',
      '',
      '--- miao-review:start ---',
      '本喵复审：通过',
      '结论：旧来源已撤回',
      '理由：复审确认旧来源不适用。',
      '建议：按新结论处理。',
      '读音：an bo',
      '来源：',
      '--- miao-review:end ---',
    ].join('\n'))

    expect(item.reviewRecord).toMatchObject({
      source: 'bot-llm',
      sources: [],
      authoritySources: [],
      commonSenseSources: [],
    })
    expect(item.reviewRecord?.evidence).not.toContain('来源：汉典')
  })
})
