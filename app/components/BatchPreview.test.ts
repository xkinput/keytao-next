// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
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

it('keeps each admin item in its diff slot or fallback even without actions', () => {
    const added = phrase('新增词', 'aa')
    const direct = phrase('直接差异', 'bb')
    useAPI.mockReturnValue({
        data: {
            contentVersion: 4,
            preview: {
                changes: [
                    {
                        phraseType: 'Phrase', codes: ['aa'], before: [], after: [added], beforeStartLine: 1,
                        diffs: [{ type: 'add', itemId: 1, phrase: added }],
                    },
                    {
                        phraseType: 'Phrase', codes: ['bb'], before: [], after: [], beforeStartLine: 20,
                        diffs: [{ type: 'add', itemId: 2, phrase: direct }],
                    },
                ],
                rejected: [{ prId: 3, action: 'Create', word: '冲突词', code: 'cc', reason: '有冲突' }],
                summary: { added: 2, modified: 0, deleted: 0, rejected: 1 },
            },
        },
    })

    const html = renderToStaticMarkup(createElement(BatchPreview, {
        batchId: 'batch-1',
        reviewing: true,
        expectedContentVersion: 4,
        reviewItems: [4, 3, 2, 1].map(id => ({ id })),
        renderReviewItem: (id, _stale, reason) => createElement('span', null, `detail-${id}`, reason),
        getReviewWeight: id => id === 1 ? 240 : undefined,
    }))

    expect(html).toMatch(/新增词\s+aa\s+240[^<]*<\/div><\/div><div[^>]*><span>detail-1/)
    expect(html.match(/detail-\d/g)).toEqual(['detail-1', 'detail-2', 'detail-3', 'detail-4'])
    expect(html).toMatch(/被拒绝的操作.*detail-3有冲突.*未出现在差异中的词条.*detail-4/)
})

it('keeps public items and votes in place through refresh and resubmission, then displays an edit', async () => {
    const first = phrase('现有词条', 'aa')
    const resubmitted = phrase('重新送审词条', 'bb')
    const edited = phrase('编辑后的词条', 'cc')
    const setPreview = (contentVersion: number, phrases: ReturnType<typeof phrase>[]) => {
        useAPI.mockReturnValue({
            data: {
                contentVersion,
                preview: {
                    changes: [{
                        phraseType: 'Phrase', codes: phrases.map(p => p.code),
                        before: [], after: phrases, beforeStartLine: 1,
                        diffs: phrases.map((p, index) => ({ type: 'add', itemId: index + 1, phrase: p })),
                    }],
                    rejected: [],
                    summary: { added: phrases.length, modified: 0, deleted: 0, rejected: 0 },
                },
            },
            mutate: vi.fn().mockResolvedValue(undefined),
        })
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    let likes = 0
    let secondStatus = '已拒绝'
    const draw = (version: number, from?: number) => act(() => root.render(createElement(BatchPreview, {
        batchId: 'batch-1',
        expectedContentVersion: version,
        reviewedFromContentVersion: from,
        reviewItems: [{ id: 1 }, { id: 2 }],
        renderLineActions: id => createElement('button', { 'data-line-vote': id }, likes),
        renderReviewItem: (id, _stale, _reason, inDiff) => createElement('div', { 'data-item': id },
            id === 2 ? secondStatus : `detail-${id}`, !inDiff && createElement('button', null, `vote-${id}`)),
    })))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    try {
        setPreview(4, [first])
        await draw(4)
        expect(useAPI.mock.lastCall?.[0]).toBe('/api/batches/batch-1/preview')
        const lineVote = container.querySelector('[data-line-vote="1"]')
        const fallbackItem = container.querySelector('li [data-item="2"]')
        expect(lineVote?.textContent).toBe('0')
        expect(fallbackItem?.textContent).toBe('已拒绝vote-2')

        likes++
        await draw(4)
        expect(lineVote?.textContent).toBe('1')

        secondStatus = '待审核'
        await draw(5, 4)
        setPreview(5, [first, resubmitted])
        await draw(5, 4)
        expect(container.querySelector('[data-line-vote="1"]')).toBe(lineVote)
        expect(container.querySelector('li [data-item="2"]')).toBe(fallbackItem)
        expect(fallbackItem?.textContent).toBe('待审核vote-2')
        expect(container.querySelectorAll('[data-item="2"]')).toHaveLength(1)

        await draw(6)
        expect(container.querySelector('li [data-item="2"]')).toBe(fallbackItem)
        setPreview(6, [first, edited])
        await draw(6)
        expect(container.textContent).toContain(edited.word)
        expect(container.querySelector('[data-line-vote="2"]')).not.toBeNull()
        expect(container.querySelector('li [data-item="2"]')).toBeNull()
    } finally {
        await act(() => root.unmount())
        vi.unstubAllGlobals()
    }
})

it('reorders by keyboard and same-code drop while keeping the other code in its frozen row', async () => {
    const moved = phrase('先候选', 'aa', 104)
    const live = phrase('现有候选', 'aa', 105)
    const next = phrase('后候选', 'aa', 108)
    const other = phrase('其他编码', 'bb')
    const movedAfter = { ...moved, weight: 106 }
    const preview = (contentVersion: number, after: typeof moved[]) => ({
        contentVersion,
        preview: {
            changes: [{ phraseType: 'Phrase', codes: ['aa', 'bb'], before: [live], after, beforeStartLine: 1,
                diffs: [moved, next, other].map((p, index) => ({ type: 'add', itemId: index + 1, phrase: p })),
            }],
            rejected: [], summary: { added: 3, modified: 0, deleted: 0, rejected: 0 },
        },
    })
    const initial = preview(1, [moved, live, next, other])
    const refreshed = preview(2, [live, movedAfter, next, { ...other, word: '外部更新' }])
    const mutate = vi.fn().mockResolvedValue(refreshed)
    const container = document.createElement('div')
    const root = createRoot(container)
    let complete!: (result: { contentVersion: number; items: { id: number; weight: number }[] }) => void
    const onReorder = vi.fn(() => new Promise<Parameters<typeof complete>[0]>(resolve => { complete = resolve }))
    const draw = (version: number) => act(() => root.render(createElement(BatchPreview, {
        batchId: 'batch-1', expectedContentVersion: version, onReorder, canReorderItem: () => true,
        reviewItems: [1, 2, 3].map(id => ({ id })),
        renderReviewItem: id => createElement('span', { 'data-item': id }),
    })))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    try {
        useAPI.mockReturnValue({ data: initial, mutate })
        await draw(1)
        const otherNode = container.querySelector('[data-item="3"]')
        expect(otherNode).not.toBeNull()
        expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(2)
        const down = container.querySelector<HTMLButtonElement>('button[aria-label="下移"]')!
        await act(() => down.click())
        expect(onReorder).toHaveBeenCalledWith('aa', 'Phrase', 1, { beforePrId: 2 })
        expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1)

        useAPI.mockReturnValue({ data: refreshed, mutate })
        await draw(2)
        expect(container.textContent).not.toContain('外部更新')
        await act(() => complete({ contentVersion: 2, items: [{ id: 1, weight: 106 }] }))
        expect(container.textContent).toMatch(/现有候选.*先候选\s+aa\s+106.*后候选.*其他编码/)
        expect(container.querySelector('[data-item="3"]')).toBe(otherNode)

        const rowFor = (word: string) => [...container.querySelectorAll('.whitespace-pre')]
            .find(node => node.textContent?.startsWith(word))!.closest('.relative')!
        const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
        const event = (type: string) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer })
        onReorder.mockRejectedValueOnce(new Error('Conflict'))
        await act(() => {
            rowFor(moved.word).querySelector('[draggable="true"]')!.dispatchEvent(event('dragstart'))
            rowFor(other.word).dispatchEvent(event('drop'))
        })
        expect(onReorder).toHaveBeenCalledTimes(1)
        await act(() => { rowFor(live.word).dispatchEvent(event('drop')) })
        expect(onReorder).toHaveBeenLastCalledWith('aa', 'Phrase', 1, { afterWord: live.word })
        expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '1')
    } finally {
        await act(() => root.unmount())
        vi.unstubAllGlobals()
    }
})
