import { describe, expect, it } from 'vitest'
import {
  getMiaomiaoEvidenceHighlights,
  getMiaomiaoSemanticEvidence,
  parseMiaomiaoReviewRemark,
} from './miaomiaoReviewRemark'

describe('miaomiaoReviewRemark', () => {
  it('removes pronunciation duplicated as evidence from persisted reviews', () => {
    const parsed = parseMiaomiaoReviewRemark([
      '--- miao-review:start ---',
      '本喵复审：通过',
      '结论：新增「欧标」至 xdbcv',
      '读音：ōu biāo',
      '证据：读音：ōu biāo',
      '证据：本喵语言常识：欧标即欧洲标准，大众通行。',
      '--- miao-review:end ---',
    ].join('\n'))

    expect(parsed.review?.evidence).toEqual(['本喵语言常识：欧标即欧洲标准，大众通行。'])
    expect(getMiaomiaoEvidenceHighlights({
      pronunciation: parsed.review?.pronunciation,
      sources: parsed.review?.sources ?? [],
      evidence: parsed.review?.evidence ?? [],
    })).toEqual([
      '读音：ōu biāo',
      '本喵语言常识：欧标即欧洲标准，大众通行。',
    ])
  })

  it('keeps ordinary remarks outside the latest structured review block', () => {
    const parsed = parseMiaomiaoReviewRemark([
      '用户备注：补充常用标准简称。',
      '',
      '--- miao-review:start ---',
      '本喵复审：需人工确认',
      '结论：编码需要复核',
      '理由：候选链不一致',
      '建议：管理员确认编码',
      '来源：汉典、维基百科',
      '时间：2026-07-11T08:40:49.119263+00:00',
      '--- miao-review:end ---',
    ].join('\n'))

    expect(parsed.baseRemark).toBe('用户备注：补充常用标准简称。')
    expect(parsed.review).toMatchObject({
      status: '需人工确认',
      conclusion: '编码需要复核',
      reason: '候选链不一致',
      suggestion: '管理员确认编码',
      sources: ['汉典', '维基百科'],
    })
  })

  it('filters metadata before limiting semantic evidence', () => {
    expect(getMiaomiaoSemanticEvidence({
      pronunciation: 'měi biāo',
      sources: ['语言常识'],
      evidence: [
        '读音：měi biāo',
        '本喵语言常识：美标即美国标准，大众通行。',
        '来源：语言常识',
        '编码 mwbc 位于候选链中。',
      ],
    })).toEqual([
      '本喵语言常识：美标即美国标准，大众通行。',
      '编码 mwbc 位于候选链中。',
    ])
  })

  it('splits source delimiters only outside parentheses', () => {
    const source = '本喵实体语境判断（常见词，暂无权威页）'
    const asciiParenthesesSource = '百科实体全称语境(Crab stick, no page)'
    const parsed = parseMiaomiaoReviewRemark([
      '--- miao-review:start ---',
      '本喵复审：通过',
      `来源：${source}；${asciiParenthesesSource}、汉典，语言常识`,
      '--- miao-review:end ---',
    ].join('\n'))

    expect(parsed.review?.sources).toEqual([
      source,
      asciiParenthesesSource,
      '汉典',
      '语言常识',
    ])
  })

  it('distinguishes an explicit empty source field from a missing source field', () => {
    const withEmptySource = parseMiaomiaoReviewRemark([
      '--- miao-review:start ---',
      '本喵复审：通过',
      '来源：',
      '--- miao-review:end ---',
    ].join('\n'))
    const withoutSource = parseMiaomiaoReviewRemark([
      '--- miao-review:start ---',
      '本喵复审：通过',
      '--- miao-review:end ---',
    ].join('\n'))

    expect(withEmptySource.review).toMatchObject({ sources: [], hasSourcesField: true })
    expect(withoutSource.review).toMatchObject({ sources: [], hasSourcesField: false })
  })

  it.each([
    ['status', '本喵复审：需复核', { status: '需复核' }],
    ['conclusion', '结论：编码需要复核', { conclusion: '编码需要复核' }],
    ['reason', '理由：候选链不一致', { reason: '候选链不一致' }],
    ['suggestion', '建议：管理员确认编码', { suggestion: '管理员确认编码' }],
    ['pronunciation', '读音：cè shì', { pronunciation: 'cè shì' }],
    ['evidence', '证据：编码 ces 位于候选链中。', { evidence: ['编码 ces 位于候选链中。'] }],
    ['time', '时间：2026-08-06T02:00:00.000Z', { generatedAt: '2026-08-06T02:00:00.000Z' }],
  ])('keeps an empty source from swallowing the following %s field', (_label, nextLine, expected) => {
    const parsed = parseMiaomiaoReviewRemark([
      '--- miao-review:start ---',
      '来源： \t',
      nextLine,
      '--- miao-review:end ---',
    ].join('\n'))

    expect(parsed.review).toMatchObject({
      sources: [],
      hasSourcesField: true,
      ...expected,
    })
  })
})
