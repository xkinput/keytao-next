// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import BatchPreview, { MiaomiaoDiffReview } from './BatchPreview'
import BatchItemVote, { BatchItemVoteCounts } from './BatchItemVote'
import ItemReviewDetail, { type ItemReviewDetailItem } from './ItemReviewDetail'
import { parseMiaomiaoReviewRemark } from '@/lib/services/miaomiaoReviewRemark'

const useAPI = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/useSWR', () => ({ useAPI }))

const phrase = (word: string, code: string, weight = 100) => ({ word, code, weight, type: 'Phrase' })
const render = (lineActionItems: { id: number; label: string }[], expectedContentVersion?: number) => renderToStaticMarkup(createElement(BatchPreview, {
    batchId: 'batch-1',
    expectedContentVersion,
    lineActionItems,
    renderLineActions: id => createElement('button', null, 'action-' + id),
}))

const reviewedRemark = [
    '作者备注',
    '喵喵审词：读音 ōu biāo；来源 暂无；',
    '本喵已按语言常识审过。',
    '--- miao-review:start ---',
    '本喵复审：需复核',
    '优先级：高（检查编码）',
    '结论：词面成立',
    '理由：大众通行；候选待查',
    '建议：核对候选',
    '读音：ōu biāo',
    '证据：读音：ōu biāo',
    '证据：本喵语言常识：大众通行。',
    '证据：汉典有例句。',
    '证据：汉典有例句',
    '常用：日常高频',
    '收录：离线词典已收录',
    '来源：汉典、规范词典',
    '时间：2026-11-25T00:00:00Z',
    '--- miao-review:end ---',
].join('\n')

it('keeps screen-reader vote labels inside positioned vote controls', () => {
    const markup = document.createElement('div')
    markup.innerHTML = renderToStaticMarkup(createElement(BatchItemVoteCounts, { likes: 5, dislikes: 2 }))
    expect([...markup.querySelectorAll('.sr-only')].map(label => label.closest('.relative')?.textContent))
        .toEqual(['赞同 5反对 2', '赞同 5反对 2'])

    markup.innerHTML = renderToStaticMarkup(createElement(BatchItemVote, {
        batchId: 'batch-1', itemId: 1, viewerId: 2, label: '欧标', isOpen: true, contentVersion: 1,
        vote: { itemId: 1, vote: null, likes: 5, dislikes: 2, canVote: true },
        onChange: vi.fn(), onStale: vi.fn(),
    }))
    expect([...markup.querySelectorAll('.sr-only')].map(label => label.closest('button.relative')?.getAttribute('aria-label')))
        .toEqual(['赞同「欧标」', '反对「欧标」'])
})

it('renders priority and deduplicated card fields in display order', () => {
    const review = parseMiaomiaoReviewRemark(reviewedRemark).review!
    const card = document.createElement('div')
    card.innerHTML = renderToStaticMarkup(createElement(MiaomiaoDiffReview, { review }))
    expect(card.querySelector('section > div')?.textContent).toBe('本喵复审需复核高优先级检查编码2026-11-25 00:00:00 UTC')
    expect([...card.querySelectorAll('dt, dd')].map(node => node.textContent)).toEqual([
        '结论', '词面成立', '理由', '大众通行；候选待查', '建议', '核对候选',
        '读音', 'ōu biāo', '证据', '汉典有例句。', '常用', '日常高频', '收录', '离线词典已收录', '来源', '规范词典',
    ])
})

it('hides a structured card in a draft preview without hiding legacy-only text', () => {
    const reviewed = { ...phrase('欧标', 'aa'), remark: reviewedRemark }
    const legacy = { ...phrase('美标', 'bb'), remark: '喵喵审词：读音 měi biāo；来源 暂无；' }
    useAPI.mockReturnValue({ data: { contentVersion: 1, preview: {
        changes: [{ phraseType: 'Phrase', codes: ['aa', 'bb'], before: [], after: [reviewed, legacy], beforeStartLine: 1,
            diffs: [{ type: 'add', itemId: 1, phrase: reviewed }, { type: 'add', itemId: 2, phrase: legacy }] }],
        rejected: [], summary: { added: 2, modified: 0, deleted: 0, rejected: 0 },
    } } })
    const html = renderToStaticMarkup(createElement(BatchPreview, { batchId: 'draft', hideMiaomiaoReview: true }))
    expect(html).not.toMatch(/本喵复审|本喵已按|ōu biāo/)
    expect(html).toContain('作者备注')
    expect(html).toContain(legacy.remark)
})

it.each([false, true])('keeps a single visible card through review and refresh (public: %s)', async publicView => {
    const added = { ...phrase('欧标', 'aa'), remark: reviewedRemark }
    const data = { contentVersion: 1, preview: {
        changes: [{ phraseType: 'Phrase', codes: ['aa'], before: [], after: [added], beforeStartLine: 1,
            diffs: [{ type: 'add', itemId: 1, phrase: added }] }],
        rejected: [], summary: { added: 1, modified: 0, deleted: 0, rejected: 0 },
    } }
    const item: ItemReviewDetailItem = {
        id: 1, word: added.word, code: null, weight: 100, status: 'Pending', action: 'Create',
        remark: reviewedRemark, hasConflict: false, conflictReason: null, dependencies: [],
        aiReview: { prId: 1, status: 'attention', severity: 'warning', title: '词面成立',
            reasons: ['大众通行；候选待查', '离线参考读音不一致'], suggestions: ['核对候选'] },
    }
    const mutate = vi.fn().mockResolvedValue(undefined)
    useAPI.mockReturnValue({ data, mutate })
    const container = document.createElement('div')
    const root = createRoot(container)
    const draw = (status: ItemReviewDetailItem['status'], hideMiaomiaoReview = false) => act(() => root.render(createElement(BatchPreview, {
        batchId: 'miao', expectedContentVersion: 1, reviewing: !publicView, hideMiaomiaoReview,
        reviewItems: [item], renderReviewItem: () => createElement(ItemReviewDetail, {
            item: { ...item, status }, publicView, hideMiaomiaoReview, waitingOnDependencies: false, actions: null,
        }),
    })))
    const cards = () => container.querySelectorAll('section[aria-label="本喵复审"]')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    try {
        await draw('Pending')
        expect(cards()).toHaveLength(1)
        const card = cards()[0]
        expect(card.closest('[hidden]')).toBeNull()
        expect(card.nextElementSibling?.textContent).toBe('作者备注')
        const content = card.outerHTML
        await draw('Approved')
        useAPI.mockReturnValue({ data: { ...data }, isValidating: true, mutate })
        await draw('Rejected')
        expect(cards()[0]).toBe(card)
        expect(card.outerHTML).toBe(content)

        await act(() => container.querySelector<HTMLButtonElement>('button[aria-label="词条详情"]')!.click())
        expect(container.textContent?.match(/词面成立/g)).toHaveLength(1)
        expect(container.textContent?.match(/作者备注/g)).toHaveLength(1)
        expect(container.textContent).toContain('离线参考读音不一致')
        expect(container.textContent).not.toMatch(/喵喵审词|本喵已按|喵备注/)

        if (publicView) {
            await draw('Pending', true)
            expect(cards()).toHaveLength(0)
            expect(container.textContent).not.toMatch(/词面成立|离线参考读音不一致|喵喵审词/)
            expect(container.textContent).toContain('作者备注')
        }
    } finally {
        await act(() => root.unmount())
        vi.unstubAllGlobals()
    }
})

it.each([false, true])('shows the review summary on click and focus (public: %s)', async publicView => {
    const summary = '已核对用法'
    const reason = '请补充来源'
    const item: ItemReviewDetailItem = {
        id: 1, word: '欧标', code: null, weight: 100, status: 'Rejected', action: 'Create',
        remark: null, hasConflict: false, conflictReason: null, dependencies: [],
        aiReview: { prId: 1, status: 'pass', severity: 'success', title: summary, reasons: [], suggestions: [],
            reviewRecord: { reviewedBy: 'Miaomiao', source: 'bot-remark', summary, sources: [], evidence: [] } },
        reviewNotes: [{ id: 1, decision: 'Rejected', reason, createdAt: '2026-11-25T00:00:00Z' }],
    }
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)
    const tooltip = () => document.body.querySelector('[role="tooltip"]')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    try {
        await act(() => root.render(createElement(ItemReviewDetail, {
            item, publicView, waitingOnDependencies: false, actions: null, rejectedReason: reason,
        })))
        const trigger = [...container.querySelectorAll('button')].find(button => button.textContent === '喵审')!
        const detail = container.querySelector<HTMLButtonElement>('button[aria-label="词条详情"]')!
        expect(tooltip()).toBeNull()
        await act(() => trigger.click())
        expect(tooltip()?.textContent).toBe(summary)
        await act(() => detail.focus())
        expect(tooltip()).toBeNull()
        await act(() => trigger.focus())
        expect(tooltip()?.textContent).toBe(summary)

        if (publicView) {
            expect(container.textContent?.match(/请补充来源/g)).toHaveLength(1)
            expect(container.querySelector('p')?.closest('[hidden]')).toBeNull()
            await act(() => detail.click())
            expect(container.textContent?.match(/请补充来源/g)).toHaveLength(1)
        }
    } finally {
        await act(() => root.unmount())
        container.remove()
        vi.unstubAllGlobals()
    }
})

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

it.each([true, false])('matches a fresh Delete layout and preserves other rows after reorder (refreshed: %s)', async hasFreshRun => {
    const moved = phrase('先候选', 'aa', 104)
    const live = phrase('现有候选', 'aa', 105)
    const deleted = phrase('待删候选', 'aa', 107)
    const next = phrase('后候选', 'aa', 108)
    const other = phrase('其他编码', 'bb')
    const movedAfter = { ...moved, weight: 106 }
    const preview = (contentVersion: number, after: typeof moved[]) => ({
        contentVersion,
        preview: {
            changes: [{ phraseType: 'Phrase', codes: ['aa', 'bb'], before: [live, deleted], after, beforeStartLine: 1,
                diffs: [...[moved, next, other].map((p, index) => ({ type: 'add', itemId: index + 1, phrase: p })),
                    { type: 'remove', itemId: 4, phrase: deleted }],
            }],
            rejected: [], summary: { added: 3, modified: 0, deleted: 1, rejected: 0 },
        },
    })
    const initial = preview(1, [moved, live, next, other])
    const refreshed = preview(2, [live, movedAfter, next, { ...other, word: '外部更新' }])
    const mutate = vi.fn().mockResolvedValue(hasFreshRun ? refreshed : undefined)
    const container = document.createElement('div')
    const root = createRoot(container)
    let complete!: (result: { contentVersion: number; items: { id: number; weight: number }[] }) => void
    const onReorder = vi.fn(() => new Promise<Parameters<typeof complete>[0]>(resolve => { complete = resolve }))
    const draw = (version: number) => act(() => root.render(createElement(BatchPreview, {
        batchId: 'batch-1', expectedContentVersion: version, onReorder, canReorderItem: () => true,
        reviewItems: [1, 2, 3, 4].map(id => ({ id })),
        renderReviewItem: id => createElement('span', { 'data-item': id }),
    })))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    try {
        const runRows = (parent: HTMLElement) => [...parent.querySelectorAll<HTMLElement>('.whitespace-pre')]
            .filter(node => node.title.endsWith(' aa')).map(node => node.textContent?.trim())
        useAPI.mockReturnValue({ data: preview(2, [live, movedAfter, next, other]), mutate })
        const fresh = document.createElement('div')
        fresh.innerHTML = render([], 2)
        expect(runRows(fresh).map(row => row?.split(/\s+/)[0])).toEqual([live.word, deleted.word, moved.word, next.word])

        useAPI.mockReturnValue({ data: initial, mutate })
        await draw(1)
        expect(runRows(container).map(row => row?.split(/\s+/)[0])).toEqual([moved.word, live.word, deleted.word, next.word])
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
        expect(runRows(container)).toEqual(runRows(fresh))
        expect(container.textContent).not.toContain('外部更新')
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
