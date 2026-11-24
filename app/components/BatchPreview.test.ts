import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import BatchPreview from './BatchPreview'

const useAPI = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/useSWR', () => ({ useAPI }))

const phrase = (word: string, code: string, weight = 100) => ({ word, code, weight, type: 'Phrase' })
const render = (lineActionItems: { id: number; label: string }[], expectedContentVersion?: number) => renderToStaticMarkup(createElement(BatchPreview, {
    batchId: 'batch-1',
    expectedContentVersion,
    lineActionItems,
    renderLineActions: id => createElement('button', null, 'action-' + id),
}))

it('matches actions to the operation behind each changed line and keeps an unmapped operation available', () => {
    const before = [phrase('删除词', 'aa'), phrase('修改前', 'bb'), phrase('原候选', 'cc')]
    const after = [phrase('修改后', 'bb'), phrase('新增词', 'cc', 50), before[2]]
    useAPI.mockReturnValue({
        data: {
            contentVersion: 3,
            preview: {
                changes: [{
                    phraseType: 'Phrase',
                    codes: ['aa', 'bb', 'cc'],
                    before, after, beforeStartLine: 15,
                    diffs: [
                        { type: 'remove', itemId: 1, phrase: before[0] },
                        { type: 'modify', itemId: 2, before: before[1], after: after[0] },
                        { type: 'add', itemId: 3, phrase: after[1] },
                        { type: 'modify', itemId: 4, before: before[2], after: before[2] },
                    ],
                }],
                rejected: [],
                summary: { added: 1, modified: 2, deleted: 1, rejected: 0 },
            },
        },
    })

    const html = render([{ id: 4, label: '净变化为空' }], 3)
    expect(html).toMatch(/删除词[^<]*<\/div><div[^>]*><button>action-1/)
    expect(html).toMatch(/修改后[^<]*<\/div><div[^>]*><button>action-2/)
    expect(html).toMatch(/新增词[^<]*<\/div><div[^>]*><button>action-3/)
    expect(html).toMatch(/未出现在差异中的词条.*净变化为空.*action-4/)
    expect(html.match(/action-/g)).toHaveLength(4)
})

it('does not place current actions beside an older version of the same entry', () => {
    const old = phrase('旧词面', 'aa')
    useAPI.mockReturnValue({
        data: {
            contentVersion: 2,
            preview: {
                changes: [{
                    phraseType: 'Phrase', codes: ['aa'], before: [], after: [old], beforeStartLine: 1,
                    diffs: [{ type: 'add', itemId: 1, phrase: old }],
                }],
                rejected: [],
                summary: { added: 1, modified: 0, deleted: 0, rejected: 0 },
            },
        },
    })
    const html = render([{ id: 1, label: '新词面' }], 3)
    expect(html).not.toContain('旧词面')
    expect(html).toMatch(/新词面.*action-1/)
})

it('keeps actions reachable when a preview fails', () => {
    useAPI.mockReturnValue({ error: new Error('Network error') })
    const html = render([{ id: 1, label: '待处理' }])
    expect(html).toMatch(/加载预览失败.*待处理.*action-1/)
})
