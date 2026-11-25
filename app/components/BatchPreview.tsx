'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react'
import { Button, Chip, Spinner } from '@/lib/heroui-compat'
import { AlertTriangle, ArrowDown, ArrowUp, Bot, CheckCircle2, GripVertical, RefreshCw, X } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'
import { getMiaomiaoCardEvidence, MIAOMIAO_PRIORITY_LABELS, parseMiaomiaoReviewRemark, stripLegacyBotReviewText,
    type MiaomiaoReviewRemarkBlock } from '@/lib/services/miaomiaoReviewRemark'
import type { ChainReorderTarget } from '@/lib/services/suggestedOrderService'

interface PreviewPhrase {
    word: string
    code: string
    type: string
    weight: number
    remark?: string
}

interface DiffItem {
    itemId?: number
    type: 'add' | 'remove' | 'modify'
    phrase?: PreviewPhrase
    before?: PreviewPhrase
    after?: PreviewPhrase
}

interface TypeChangeGroup {
    phraseType: string
    codes: string[]
    diffs: DiffItem[]
    before: PreviewPhrase[]
    after: PreviewPhrase[]
    beforeStartLine: number
}

interface PreviewStats {
    added: number
    modified: number
    deleted: number
    rejected: number
}

interface RejectedOperation {
    prId: number
    action: string
    word: string
    code: string
    oldWord?: string
    reason: string
}

interface PreviewResult {
    changes: TypeChangeGroup[]
    rejected: RejectedOperation[]
    summary: PreviewStats
}

interface BatchPreviewProps {
    batchId: string
    defaultCollapsed?: boolean
    hideMiaomiaoReview?: boolean
    reviewing?: boolean
    expectedContentVersion?: number
    reviewedFromContentVersion?: number
    reviewCounts?: { pending: number; reviewed: number }
    onNewerReviewPreview?: () => Promise<void>
    renderLineActions?: (itemId: number, stale?: boolean) => ReactNode
    lineActionItems?: readonly { id: number; label: string; code?: string | null }[]
    reviewItems?: readonly { id: number }[]
    renderReviewItem?: (itemId: number, stale: boolean, rejectedReason?: string, inDiff?: boolean, previewRemark?: string) => ReactNode
    getReviewWeight?: (itemId: number) => number | undefined
    renderReviewControls?: (outdated: boolean) => ReactNode
    onReorder?: (code: string, type: string, movedPrId: number, target: ChainReorderTarget) => Promise<{
        contentVersion: number
        items: { id: number; weight?: number | null; remark?: string | null }[]
    }>
    canReorderItem?: (itemId: number) => boolean
    onAddFirst?: () => void
}

type UnifiedLine =
    | { kind: 'context'; phrase: PreviewPhrase; oldLine: number; newLine: number }
    | { kind: 'remove'; phrase: PreviewPhrase; oldLine: number }
    | { kind: 'add'; phrase: PreviewPhrase; newLine: number }

interface Hunk {
    oldStart: number
    oldCount: number
    newStart: number
    newCount: number
    lines: UnifiedLine[]
}

const phraseKey = (p: PreviewPhrase) => `${p.word}@@${p.code}`
const reorderKey = (p: PreviewPhrase) => JSON.stringify([p.type, p.code, p.word])
const reorderRunKey = (p: PreviewPhrase) => `${p.type}:${p.code}`
const draftAfter = (diff: DiffItem) => diff.type === 'add' ? diff.phrase : diff.after
type ReorderSource = { itemId: number; code: string; type: string }
type DiffReorder = {
    drag: RefObject<ReorderSource | null>
    pendingId: number | null
    disabled: boolean
    canMove: NonNullable<BatchPreviewProps['canReorderItem']>
    move: (source: ReorderSource, target: ChainReorderTarget) => void
}

function comparePhrases(a: PreviewPhrase, b: PreviewPhrase): number {
    const codeCmp = a.code.localeCompare(b.code)
    if (codeCmp !== 0) return codeCmp

    if (a.weight !== b.weight) return a.weight - b.weight

    return a.word.localeCompare(b.word, 'zh')
}

function compareAddedLinesForDisplay(a: Extract<UnifiedLine, { kind: 'add' }>, b: Extract<UnifiedLine, { kind: 'add' }>): number {
    if (a.phrase.code.length !== b.phrase.code.length) return a.phrase.code.length - b.phrase.code.length

    const codeCmp = a.phrase.code.localeCompare(b.phrase.code)
    if (codeCmp !== 0) return codeCmp

    if (a.phrase.weight !== b.phrase.weight) return a.phrase.weight - b.phrase.weight

    return a.phrase.word.localeCompare(b.phrase.word, 'zh')
}

function normalizeHunkLinesForDisplay(lines: UnifiedLine[]): UnifiedLine[] {
    const normalized: UnifiedLine[] = []
    let segment: UnifiedLine[] = []

    const flushSegment = () => {
        if (segment.length === 0) return

        const removes = segment.filter((line): line is Extract<UnifiedLine, { kind: 'remove' }> => line.kind === 'remove')
        const adds = segment
            .filter((line): line is Extract<UnifiedLine, { kind: 'add' }> => line.kind === 'add')
            .sort(compareAddedLinesForDisplay)

        normalized.push(...removes, ...adds)
        segment = []
    }

    for (const line of lines) {
        if (line.kind === 'context') {
            flushSegment()
            normalized.push(line)
            continue
        }

        segment.push(line)
    }

    flushSegment()
    return normalized
}

function computeUnifiedDiff(before: PreviewPhrase[], after: PreviewPhrase[], contextSize = 3, startLine = 1): Hunk[] {
    const beforeMap = new Map(before.map(p => [phraseKey(p), p]))
    const afterMap = new Map(after.map(p => [phraseKey(p), p]))

    const lines: UnifiedLine[] = []
    let oldLine = startLine
    let newLine = startLine

    let beforeIndex = 0
    let afterIndex = 0

    while (beforeIndex < before.length || afterIndex < after.length) {
        const beforePhrase = before[beforeIndex]
        const afterPhrase = after[afterIndex]

        if (!beforePhrase && afterPhrase) {
            lines.push({ kind: 'add', phrase: afterPhrase, newLine: newLine++ })
            afterIndex++
            continue
        }

        if (beforePhrase && !afterPhrase) {
            lines.push({ kind: 'remove', phrase: beforePhrase, oldLine: oldLine++ })
            beforeIndex++
            continue
        }

        const beforeKey = phraseKey(beforePhrase!)
        const afterKey = phraseKey(afterPhrase!)

        if (beforeKey === afterKey) {
            const b = beforeMap.get(beforeKey)!
            const a = afterMap.get(afterKey)!
            if (b.type !== a.type || b.weight !== a.weight || b.remark !== a.remark) {
                lines.push({ kind: 'remove', phrase: b, oldLine: oldLine++ })
                lines.push({ kind: 'add', phrase: a, newLine: newLine++ })
            } else {
                lines.push({ kind: 'context', phrase: b, oldLine: oldLine++, newLine: newLine++ })
            }
            beforeIndex++
            afterIndex++
            continue
        }

        if (comparePhrases(beforePhrase!, afterPhrase!) < 0) {
            lines.push({ kind: 'remove', phrase: beforePhrase!, oldLine: oldLine++ })
            beforeIndex++
            continue
        }

        lines.push({ kind: 'add', phrase: afterPhrase!, newLine: newLine++ })
        afterIndex++
    }

    // Find changed line indices
    const changedIndices = new Set<number>()
    lines.forEach((line, i) => {
        if (line.kind !== 'context') changedIndices.add(i)
    })

    if (changedIndices.size === 0) return []

    // Expand to include context
    const included = new Set<number>()
    changedIndices.forEach(i => {
        for (let j = Math.max(0, i - contextSize); j <= Math.min(lines.length - 1, i + contextSize); j++) {
            included.add(j)
        }
    })

    // Group into contiguous hunks
    const sorted = Array.from(included).sort((a, b) => a - b)
    const hunks: Hunk[] = []
    let hunkLines: UnifiedLine[] = []
    let prevIdx = -2

    for (const idx of sorted) {
        if (idx !== prevIdx + 1 && hunkLines.length > 0) {
            hunks.push(buildHunk(hunkLines))
            hunkLines = []
        }
        hunkLines.push(lines[idx])
        prevIdx = idx
    }
    if (hunkLines.length > 0) hunks.push(buildHunk(hunkLines))

    return hunks
}

function buildHunk(lines: UnifiedLine[]): Hunk {
    const normalizedLines = normalizeHunkLinesForDisplay(lines)
    const first = normalizedLines[0]

    const oldStart = first.kind === 'add' ? (normalizedLines.find(l => l.kind !== 'add') as Extract<UnifiedLine, { oldLine: number }>)?.oldLine ?? 1 : (first as Extract<UnifiedLine, { oldLine: number }>).oldLine
    const newStart = first.kind === 'remove' ? (normalizedLines.find(l => l.kind !== 'remove') as Extract<UnifiedLine, { newLine: number }>)?.newLine ?? 1 : (first as Extract<UnifiedLine, { newLine: number }>).newLine

    const oldCount = normalizedLines.filter(l => l.kind !== 'add').length
    const newCount = normalizedLines.filter(l => l.kind !== 'remove').length

    return { oldStart: oldStart ?? 1, newStart: newStart ?? 1, oldCount, newCount, lines: normalizedLines }
}

function formatPhraseLine(p: PreviewPhrase, weight = p.weight): string {
    return [p.word.padEnd(12), p.code.padEnd(8), String(weight).padEnd(6)].join('  ')
}

function prepareDiff(group: TypeChangeGroup) {
    const hunks = computeUnifiedDiff(group.before, group.after, 3, group.beforeStartLine)
    const actionRows = new Map<UnifiedLine, number>()
    const base = { hunks, actionRows, after: group.after, diffs: group.diffs }
    if (!hunks.length) {
        return { ...base, shownIds: group.diffs.flatMap(diff => diff.itemId === undefined ? [] : [diff.itemId]) }
    }

    const actionKey = (kind: 'add' | 'remove', phrase: PreviewPhrase) => JSON.stringify([kind, phrase.type, phrase.word, phrase.code])
    const candidates = new Map<string, number | null>()
    for (const diff of group.diffs) {
        const phrase = diff.type === 'modify' ? diff.after : diff.phrase
        if (!phrase || diff.itemId === undefined) continue
        const key = actionKey(diff.type === 'remove' ? 'remove' : 'add', phrase)
        // A net line cannot distinguish two operations with an identical target.
        candidates.set(key, candidates.has(key) ? null : diff.itemId)
    }
    for (const { lines } of hunks) {
        for (const line of lines) {
            if (line.kind === 'context') continue
            const key = actionKey(line.kind, line.phrase)
            const itemId = candidates.get(key)
            if (typeof itemId === 'number') {
                actionRows.set(line, itemId)
                candidates.delete(key)
            }
        }
    }
    return { ...base, shownIds: [...actionRows.values()] }
}

function replaceRun(layout: ReturnType<typeof prepareDiff>, source: ReorderSource, nextRun: PreviewPhrase[]) {
    const inRun = (phrase: PreviewPhrase) => phrase.code === source.code && phrase.type === source.type
    const positions = new Map(nextRun.map((phrase, index) => [reorderKey(phrase), index]))
    const start = layout.after.findIndex(inRun)
    const after = layout.after.flatMap((phrase, index) => inRun(phrase) ? index === start ? nextRun : [] : [phrase])
    if (!layout.hunks.length) {
        const slots = new Map(layout.diffs.flatMap(diff => {
            const phrase = draftAfter(diff)
            const position = phrase && positions.get(reorderKey(phrase))
            return position === undefined ? [] : [[diff, position] as const]
        }))
        const sorted = [...slots].sort((a, b) => a[1] - b[1]).map(([diff, position]) =>
            diff.type === 'add' ? { ...diff, phrase: nextRun[position] } : { ...diff, after: nextRun[position] })
        let index = 0
        return { ...layout, after, diffs: layout.diffs.map(diff => slots.has(diff) ? sorted[index++] : diff) }
    }
    const lines = layout.hunks.flatMap(hunk => hunk.lines.filter((line): line is Exclude<UnifiedLine, { kind: 'remove' }> => line.kind !== 'remove' &&
        inRun(line.phrase) && positions.has(reorderKey(line.phrase))))
    const sorted = lines.toSorted((a, b) => positions.get(reorderKey(a.phrase))! - positions.get(reorderKey(b.phrase))!)
    const actionRows = new Map(layout.actionRows)
    const replacements = new Map(lines.map((line, index) => {
        const moved = sorted[index]
        const next = { ...moved, phrase: nextRun[positions.get(reorderKey(moved.phrase))!], newLine: line.newLine }
        actionRows.delete(line)
        return [line, next] as const
    }))
    sorted.forEach((line, index) => {
        const id = layout.actionRows.get(line)
        if (id !== undefined) actionRows.set(replacements.get(lines[index])!, id)
    })
    return { ...layout, after, actionRows, hunks: layout.hunks.map(hunk => ({
        ...hunk, lines: hunk.lines.map(line => line.kind === 'remove' ? line : replacements.get(line) ?? line),
    })) }
}

function formatReviewTime(value: string): string {
    return value
        .replace('T', ' ')
        .replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, '')
        .replace(/Z$/, ' UTC')
        .replace(/\+00:00$/, ' UTC')
}

export function MiaomiaoDiffReview({ review }: { review: MiaomiaoReviewRemarkBlock }) {
    const passed = Boolean(review.status?.includes('通过') && !review.status.includes('不通过'))
    const { priority, priorityReason } = review
    const { evidence, sources } = getMiaomiaoCardEvidence(review)
    const fields = [
        { label: '结论', value: review.conclusion },
        { label: '理由', value: review.reason },
        { label: '建议', value: review.suggestion },
        { label: '读音', value: review.pronunciation },
        { label: '证据', value: evidence.join('；') },
        { label: '常用', value: review.commonness?.daily },
        { label: '收录', value: review.commonness?.authority },
        { label: '来源', value: sources.join('、') },
    ].filter((field): field is { label: string; value: string } => Boolean(field.value))

    return (
        <section aria-label="本喵复审" className="mt-1 max-w-5xl rounded bg-[#16192a] px-2 py-1 font-sans text-xs text-[#a9b1d6]">
            <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5">
                <Bot className="size-3.5 text-[#7dcfff]" aria-hidden="true" />
                <span className="font-medium text-[#c0caf5]">本喵复审</span>
                {review.status && (
                    <span className={`inline-flex items-center gap-1 ${passed ? 'text-[#9ece6a]' :
                        review.status === '需人工确认' ? 'text-[#f7768e]' : 'text-[#e0af68]'}`}>
                        {passed ? <CheckCircle2 className="size-3" aria-hidden="true" /> : <AlertTriangle className="size-3" aria-hidden="true" />}
                        {review.status}
                    </span>
                )}
                {priority && (
                    <Chip size="sm" variant="flat" color={priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'default'}>
                        {MIAOMIAO_PRIORITY_LABELS[priority]}优先级
                    </Chip>
                )}
                {priorityReason && <span className="min-w-0 break-words">{priorityReason}</span>}
                {review.generatedAt && (
                    <time className="ml-auto text-[#858db4]" dateTime={review.generatedAt}>{formatReviewTime(review.generatedAt)}</time>
                )}
            </div>
            {fields.length > 0 && (
                <dl className="mt-0.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 leading-4">
                    {fields.map(field => (
                        <div key={field.label} className="contents">
                            <dt className="text-[#7dcfff]">{field.label}</dt>
                            <dd className="min-w-0 break-words">{field.value}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </section>
    )
}

function PhraseLineContent({ phrase, colorClass, actions, reviewDetail, reviewWeight, hideMiaomiaoReview }: {
    phrase: PreviewPhrase
    colorClass: string
    actions?: ReactNode
    reviewDetail?: ReactNode
    reviewWeight?: number
    hideMiaomiaoReview?: boolean
}) {
    const parsedRemark = reviewDetail ? undefined : parseMiaomiaoReviewRemark(phrase.remark)
    const baseRemark = parsedRemark && stripLegacyBotReviewText(parsedRemark)

    return (
        <div className="min-w-0 flex-1 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-x-3">
                <div className={`whitespace-pre ${colorClass}`}>{formatPhraseLine(phrase, reviewWeight)}</div>
                {actions && <div className="ml-auto shrink-0 font-sans text-[#c0caf5]">{actions}</div>}
            </div>
            {baseRemark && (
                <div className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-[#737aa2]">
                    {baseRemark}
                </div>
            )}
            {!hideMiaomiaoReview && parsedRemark?.review && <MiaomiaoDiffReview review={parsedRemark.review} />}
            {reviewDetail && <div className="font-sans text-[#c0caf5]">{reviewDetail}</div>}
        </div>
    )
}

function DiffView({ layout, renderLineActions, renderReviewItem, getReviewWeight, hideMiaomiaoReview, reorder }: {
    layout: ReturnType<typeof prepareDiff>
    renderLineActions?: BatchPreviewProps['renderLineActions']
    renderReviewItem?: (itemId: number, previewRemark?: string) => ReactNode
    getReviewWeight?: BatchPreviewProps['getReviewWeight']
    hideMiaomiaoReview?: boolean
    reorder?: DiffReorder
}) {
    const { hunks, actionRows } = layout
    const hasFull = hunks.length > 0
    const targets = new Map<string, number | null>()
    const runs = new Map<string, PreviewPhrase[]>()
    if (reorder) {
        for (const diff of layout.diffs) {
            const phrase = draftAfter(diff)
            if (!phrase || diff.itemId === undefined) continue
            const key = reorderKey(phrase)
            targets.set(key, targets.has(key) ? null : diff.itemId)
        }
        for (const phrase of layout.after) {
            const key = reorderRunKey(phrase)
            const run = runs.get(key)
            if (run) run.push(phrase)
            else runs.set(key, [phrase])
        }
    }
    const runFor = (phrase: PreviewPhrase) => runs.get(reorderRunKey(phrase)) ?? []
    const targetFor = (phrase?: PreviewPhrase): ChainReorderTarget | undefined => {
        if (!phrase) return { beforePrId: null }
        const id = targets.get(reorderKey(phrase))
        if (id === undefined) return { afterWord: phrase.word }
        if (id !== null && reorder?.canMove(id)) return { beforePrId: id }
    }
    const dropProps = (phrase: PreviewPhrase, atEnd = false) => {
        if (!reorder || reorder.disabled || reorder.pendingId !== null || !targetFor(phrase)) return {}
        const target = () => {
            const source = reorder.drag.current
            if (!source || source.code !== phrase.code || source.type !== phrase.type) return
            const run = runFor(phrase)
            const index = run.findIndex(p => reorderKey(p) === reorderKey(phrase))
            if (index < 0) return
            const destination = atEnd ? targetFor() : targetFor(phrase)
            if (!destination || destination.beforePrId === source.itemId ||
                (atEnd ? targetFor(phrase)?.beforePrId === source.itemId :
                    targetFor(run[index - 1])?.beforePrId === source.itemId)) return
            return { source, destination }
        }
        return {
            onDragOver: (event: DragEvent<HTMLElement>) => {
                if (atEnd) event.stopPropagation()
                if (!target()) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
            },
            onDrop: (event: DragEvent<HTMLElement>) => {
                if (atEnd) event.stopPropagation()
                const drop = target()
                if (!drop) return
                event.preventDefault()
                reorder.drag.current = null
                reorder.move(drop.source, drop.destination)
            },
        }
    }
    const endDropTarget = (phrase: PreviewPhrase) => {
        const run = runFor(phrase)
        const last = run.at(-1)
        if (!last || run.length < 2 || reorderKey(last) !== reorderKey(phrase)) return null
        const handlers = dropProps(phrase, true)
        return handlers.onDrop && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2" {...handlers} />
    }
    const actionsFor = (itemId?: number, phrase?: PreviewPhrase) => {
        if (itemId === undefined) return undefined
        const actions = renderLineActions?.(itemId)
        if (!phrase || !reorder?.canMove(itemId) || targets.get(reorderKey(phrase)) !== itemId) return actions
        const run = runFor(phrase)
        const index = run.findIndex(p => reorderKey(p) === reorderKey(phrase))
        if (index < 0 || run.length < 2) return actions
        const source = { itemId, code: phrase.code, type: phrase.type }
        const up = index > 0 ? targetFor(run[index - 1]) : undefined
        const down = index < run.length - 1 ? targetFor(run[index + 2]) : undefined
        const disabled = reorder.disabled || reorder.pendingId !== null
        const busy = reorder.pendingId === itemId
        return (
            <div className="flex items-center gap-1" aria-busy={busy || undefined}>
                <span aria-label="拖动调整顺序" role="img" draggable={!disabled}
                    className={disabled ? undefined : 'cursor-grab'}
                    onDragStart={event => {
                        if (disabled) return event.preventDefault()
                        reorder.drag.current = source
                        event.dataTransfer.setData('text/plain', String(itemId))
                        event.dataTransfer.effectAllowed = 'move'
                    }} onDragEnd={() => { reorder.drag.current = null }}>
                    {busy ? <RefreshCw className="size-4 motion-safe:animate-spin" aria-hidden="true" /> :
                        <GripVertical className="size-4" aria-hidden="true" />}
                </span>
                <Button isIconOnly type="button" size="sm" variant="light" aria-label="上移" aria-disabled={disabled || !up}
                    onPress={() => { if (!disabled && up) reorder.move(source, up) }}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button isIconOnly type="button" size="sm" variant="light" aria-label="下移" aria-disabled={disabled || !down}
                    onPress={() => { if (!disabled && down) reorder.move(source, down) }}>
                    <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                {actions}
            </div>
        )
    }
    const detailFor = (itemId: number | undefined, phrase: PreviewPhrase) =>
        itemId === undefined ? undefined : renderReviewItem?.(itemId, phrase.remark)
    const weightFor = (itemId?: number) => itemId === undefined ? undefined : getReviewWeight?.(itemId)

    return (
        <div className="font-mono text-sm overflow-x-auto">
            {hasFull ? (
                hunks.map(hunk => (
                    <div key={`${hunk.oldStart}:${hunk.newStart}`}>
                        {/* Hunk header */}
                        <div className="px-4 py-1.5 bg-[#1e2030] text-[#7dcfff] border-y border-[#2a2d3e]">
                            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                        </div>
                        {hunk.lines.map(line => {
                            const itemId = actionRows.get(line)
                            const key = itemId ?? `${line.kind}:${phraseKey(line.phrase)}`
                            if (line.kind === 'context') {
                                return (
                                    <div key={key} {...dropProps(line.phrase)} className="relative flex gap-0 text-[#565f89] hover:bg-[#1e2030]/50">
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a2d3e] shrink-0 text-[#3b4261]">{line.oldLine}</span>
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a2d3e] shrink-0 text-[#3b4261]">{line.newLine}</span>
                                        <span className="px-3 py-1.5 select-none w-6 shrink-0"> </span>
                                        <PhraseLineContent phrase={line.phrase} colorClass="text-[#565f89]" hideMiaomiaoReview={hideMiaomiaoReview} />
                                        {endDropTarget(line.phrase)}
                                    </div>
                                )
                            }
                            if (line.kind === 'remove') {
                                return (
                                    <div key={key} className="flex gap-0 bg-[#3d1515]/40 hover:bg-[#3d1515]/60">
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#5a2020] shrink-0 text-[#f7768e] font-semibold">{line.oldLine}</span>
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#5a2020] shrink-0 text-[#3b4261]"> </span>
                                        <span className="px-3 py-1.5 text-[#f7768e] select-none w-6 shrink-0">-</span>
                                        <PhraseLineContent phrase={line.phrase} colorClass="text-[#f7768e]"
                                            actions={actionsFor(itemId)} reviewDetail={detailFor(itemId, line.phrase)} hideMiaomiaoReview={hideMiaomiaoReview} />
                                    </div>
                                )
                            }
                            // add
                            return (
                                <div key={key} {...dropProps(line.phrase)} className="relative flex gap-0 bg-[#1a3a1a]/40 hover:bg-[#1a3a1a]/60">
                                    <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a5a2a] shrink-0 text-[#3b4261]"> </span>
                                    <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a5a2a] shrink-0 text-[#9ece6a] font-semibold">{line.newLine}</span>
                                    <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                    <PhraseLineContent phrase={line.phrase} colorClass="text-[#9ece6a]"
                                        actions={actionsFor(itemId, line.phrase)} reviewDetail={detailFor(itemId, line.phrase)}
                                        reviewWeight={weightFor(itemId)} hideMiaomiaoReview={hideMiaomiaoReview} />
                                    {endDropTarget(line.phrase)}
                                </div>
                            )
                        })}
                    </div>
                ))
            ) : (
                // Fallback: no context, render diffs directly
                <div>
                    <div className="px-4 py-1.5 bg-[#1e2030] text-[#7dcfff] border-y border-[#2a2d3e]">
                        @@ changes @@
                    </div>
                    {layout.diffs.map(diff => {
                        if (diff.type === 'remove' && diff.phrase) {
                            return (
                                <div key={diff.itemId ?? `remove:${phraseKey(diff.phrase)}`} className="flex gap-0 bg-[#3d1515]/40">
                                    <span className="px-3 py-1.5 text-[#f7768e] select-none w-6 shrink-0">-</span>
                                    <PhraseLineContent phrase={diff.phrase} colorClass="text-[#f7768e]"
                                        actions={actionsFor(diff.itemId)} reviewDetail={detailFor(diff.itemId, diff.phrase)} hideMiaomiaoReview={hideMiaomiaoReview} />
                                </div>
                            )
                        }
                        if (diff.type === 'add' && diff.phrase) {
                            return (
                                <div key={diff.itemId ?? `add:${phraseKey(diff.phrase)}`} {...dropProps(diff.phrase)} className="relative flex gap-0 bg-[#1a3a1a]/40">
                                    <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                    <PhraseLineContent phrase={diff.phrase} colorClass="text-[#9ece6a]"
                                        actions={actionsFor(diff.itemId, diff.phrase)} reviewDetail={detailFor(diff.itemId, diff.phrase)}
                                        reviewWeight={weightFor(diff.itemId)} hideMiaomiaoReview={hideMiaomiaoReview} />
                                    {endDropTarget(diff.phrase)}
                                </div>
                            )
                        }
                        if (diff.type === 'modify' && diff.before && diff.after) {
                            return (
                                <div key={diff.itemId ?? `modify:${phraseKey(diff.after)}`}>
                                    <div className="flex gap-0 bg-[#3d1515]/40">
                                        <span className="px-3 py-1.5 text-[#f7768e] select-none w-6 shrink-0">-</span>
                                        <PhraseLineContent phrase={diff.before} colorClass="text-[#f7768e]" hideMiaomiaoReview={hideMiaomiaoReview} />
                                    </div>
                                    <div {...dropProps(diff.after)} className="relative flex gap-0 bg-[#1a3a1a]/40">
                                        <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                        <PhraseLineContent phrase={diff.after} colorClass="text-[#9ece6a]"
                                            actions={actionsFor(diff.itemId, diff.after)} reviewDetail={detailFor(diff.itemId, diff.after)}
                                            reviewWeight={weightFor(diff.itemId)} hideMiaomiaoReview={hideMiaomiaoReview} />
                                        {endDropTarget(diff.after)}
                                    </div>
                                </div>
                            )
                        }
                        return null
                    })}
                </div>
            )}
        </div>
    )
}

export default function BatchPreview({ defaultCollapsed = false, onAddFirst, ...props }: BatchPreviewProps) {
    const [collapsible] = useState(defaultCollapsed)
    const [expanded, setExpanded] = useState(false)
    if (onAddFirst) return (
        <div className="space-y-4 py-8 text-center">
            <p className="text-default-500">还没有添加任何修改</p>
            <Button color="primary" onPress={onAddFirst}>添加第一个修改</Button>
        </div>
    )
    if (!collapsible) return <BatchPreviewContent key={props.batchId} {...props} />

    return (
        <div className="space-y-4">
            <Button type="button" size="sm" variant="flat" aria-expanded={expanded}
                onPress={() => setExpanded(value => !value)}>
                {expanded ? '收起差异' : '展开差异'}
            </Button>
            {expanded && <BatchPreviewContent key={props.batchId} {...props} />}
        </div>
    )
}

function BatchPreviewContent({
    batchId, reviewing = false, expectedContentVersion, reviewedFromContentVersion, onNewerReviewPreview,
    renderLineActions, lineActionItems, reviewCounts, reviewItems, renderReviewItem, getReviewWeight, renderReviewControls,
    onReorder, canReorderItem, hideMiaomiaoReview,
}: BatchPreviewProps) {
    const [reviewLayout, setReviewLayout] = useState<PreviewResult>()
    const [publicLayout, setPublicLayout] = useState<{ contentVersion: number; preview: PreviewResult }>()
    const [reorderedLayouts, setReorderedLayouts] = useState<{
        preview: PreviewResult; layouts: Map<TypeChangeGroup, ReturnType<typeof prepareDiff>>
    }>()
    const drag = useRef<ReorderSource | null>(null)
    const reorderInFlight = useRef(false)
    const [reorderingId, setReorderingId] = useState<number | null>(null)
    const { data, error, isLoading, isValidating, mutate } = useAPI<{ contentVersion: number; preview: PreviewResult }>(
        `/api/batches/${batchId}/preview${reviewing ? '?review=1' : ''}`,
        { keepPreviousData: false, revalidateOnFocus: !reviewing, revalidateOnReconnect: !reviewing },
    )
    const previewVersion = data?.contentVersion
    const isReviewedVersion = (version: number) => expectedContentVersion !== undefined &&
        reviewedFromContentVersion !== undefined &&
        version >= reviewedFromContentVersion && version <= expectedContentVersion
    const outdated = Boolean(data && expectedContentVersion !== undefined &&
        data.contentVersion !== expectedContentVersion && !isReviewedVersion(data.contentVersion))
    const newerPreview = previewVersion !== undefined && expectedContentVersion !== undefined &&
        previewVersion > expectedContentVersion

    const refresh = useCallback(() => newerPreview && onNewerReviewPreview
        ? onNewerReviewPreview()
        : mutate().catch(() => undefined), [newerPreview, onNewerReviewPreview, mutate])
    useEffect(() => {
        if (outdated && reorderingId === null) void refresh()
    }, [outdated, expectedContentVersion, previewVersion, refresh, reorderingId])

    const adminReview = reviewing && Boolean(renderReviewItem)
    const publicDetails = !reviewing && Boolean(renderReviewItem)
    const compatiblePreview = !outdated ? data?.preview : undefined
    // Review metadata can change hunk membership without changing the items under review.
    if (adminReview && !reviewLayout && compatiblePreview) {
        setReviewLayout({
            ...compatiblePreview,
            rejected: [...(compatiblePreview.rejected ?? [])].sort((a, b) => a.code.localeCompare(b.code) || a.prId - b.prId),
        })
    }
    // Keep displayed rows anchored while data catches up or a resubmission changes only review state.
    const keepPublicLayout = publicLayout && (
        reorderingId !== null || outdated || publicLayout.contentVersion === expectedContentVersion || isReviewedVersion(publicLayout.contentVersion)
    )
    const displayedPublicLayout = keepPublicLayout || !compatiblePreview ? publicLayout : data
    if (publicDetails && displayedPublicLayout !== publicLayout) setPublicLayout(displayedPublicLayout)
    const preview = adminReview
        ? reviewLayout ?? compatiblePreview
        : publicDetails ? displayedPublicLayout?.preview
            : reviewing || (!error && !outdated) ? data?.preview : undefined
    const stalePublicLines = publicDetails && displayedPublicLayout && expectedContentVersion !== undefined &&
        displayedPublicLayout.contentVersion !== expectedContentVersion && !isReviewedVersion(displayedPublicLayout.contentVersion)
    const changes = preview?.changes
    const layouts = useMemo(() => new Map(changes?.map(group => [group,
        (reorderedLayouts?.preview === preview ? reorderedLayouts?.layouts.get(group) : undefined) ?? prepareDiff(group),
    ])), [changes, preview, reorderedLayouts])
    const move = async (group: TypeChangeGroup, source: ReorderSource, target: ChainReorderTarget) => {
        if (!preview || !onReorder || reorderInFlight.current) return
        const layout = layouts.get(group)!
        reorderInFlight.current = true
        setReorderingId(source.itemId)
        try {
            const saved = await onReorder(source.code, source.type, source.itemId, target)
            const inRun = (p: PreviewPhrase) => p.code === source.code && p.type === source.type
            const fresh = await mutate().catch(() => undefined)
            const freshRun = fresh?.contentVersion === saved.contentVersion
                ? fresh.preview.changes.find(g => g.phraseType === source.type && g.codes.includes(source.code))?.after.filter(inRun)
                : undefined
            const after = layout.after.filter(inRun)
            const phraseFor = (id: number) => {
                const diff = group.diffs.find(item => item.itemId === id)
                return diff && draftAfter(diff)
            }
            const moved = phraseFor(source.itemId)!
            const anchor = typeof target.beforePrId === 'number' ? phraseFor(target.beforePrId)?.word : target.afterWord
            const remaining = after.filter(phrase => phrase.word !== moved.word)
            const at = remaining.findIndex(phrase => phrase.word === anchor)
            remaining.splice(at < 0 ? remaining.length : at, 0, after.find(phrase => phrase.word === moved.word) ?? moved)
            const savedPhrases = new Map(saved.items.flatMap(item => {
                const phrase = phraseFor(item.id)
                return phrase ? [[reorderKey(phrase), item] as const] : []
            }))
            const nextRun = freshRun?.length ? freshRun : remaining.map(phrase => {
                const item = savedPhrases.get(reorderKey(phrase))
                return item ? { ...phrase, weight: item.weight ?? phrase.weight, remark: item.remark ?? undefined } : phrase
            })
            setReorderedLayouts(current => {
                const next = new Map(current?.preview === preview ? current.layouts : undefined)
                next.set(group, replaceRun(layout, source, nextRun))
                return { preview, layouts: next }
            })
            if (publicDetails) setPublicLayout({ preview, contentVersion: saved.contentVersion })
        } catch {
            // The caller handles the request error and resync.
        } finally {
            reorderInFlight.current = false
            setReorderingId(null)
        }
    }
    const lineActions = renderLineActions && ((id: number) => renderLineActions(id, reviewing ? outdated : Boolean(stalePublicLines)))
    const reviewDetail = renderReviewItem && ((id: number, reason?: string, inDiff = false, previewRemark?: string) =>
        renderReviewItem(id, reviewing ? outdated : inDiff && Boolean(stalePublicLines), reason, inDiff, previewRemark))
    const publicRejectionReasons = publicDetails
        ? new Map(compatiblePreview?.rejected?.map(op => [op.prId, op.reason]))
        : undefined
    const reviewControls = renderReviewControls?.(outdated)

    const shownIds = new Set([...layouts.values()].flatMap(layout => layout.shownIds))
    for (const operation of preview?.rejected ?? []) {
        shownIds.add(operation.prId)
    }
    const fallbackRows = reviewDetail && reviewItems ? reviewItems
        .filter(item => !shownIds.has(item.id))
        .map(item => (
            <li key={item.id} className="overflow-x-auto px-3 py-1.5">{reviewDetail(item.id)}</li>
        )) : lineActions && lineActionItems?.flatMap(item => {
        if (shownIds.has(item.id)) return []
        const actions = lineActions(item.id)
        if (!actions) return []
        return [(
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                <span>{item.label} {item.code && <code className="text-default-500">{item.code}</code>}</span>
                <div className="ml-auto shrink-0">{actions}</div>
            </li>
        )]
    })
    const fallback = fallbackRows?.length ? (
        <div className="mt-4 rounded-lg border border-default-200">
            <h3 className="border-b border-default-200 px-3 py-2 text-sm font-medium">未出现在差异中的词条</h3>
            <ul className="divide-y divide-default-100">{fallbackRows}</ul>
        </div>
    ) : null

    if (!preview && ((isLoading && !data) || (adminReview && outdated && !error))) {
        return (
            <div>
                {reviewControls}
                <div className="flex justify-center items-center py-12">
                    <Spinner size="lg" label="加载预览..." />
                </div>
            </div>
        )
    }

    if (adminReview ? !preview : !(publicDetails && preview) && (!data || (error && !reviewing))) {
        return (
            <div>
                {reviewControls}
                <div className="text-center py-8">
                    <p className="text-danger">加载预览失败</p>
                    <p className="text-default-500 text-small">{error?.message || '未知错误'}</p>
                    {reviewing && <button type="button" className="mt-2 underline" onClick={() => void refresh()}>重试加载差异</button>}
                </div>
                {fallback}
            </div>
        )
    }

    if (!preview && outdated && !reviewing) {
        return (
            <div className="py-4">
                <p role="status" className="text-center text-small text-default-500">批次有更新，正在重新加载差异</p>
                {fallback}
            </div>
        )
    }

    if (!preview) return null
    const { changes: previewChanges, rejected = [], summary } = preview
    const total = summary.added + summary.modified + summary.deleted
    const reviewPreviewStatus = reviewing && outdated && !isValidating && (
        <div className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-lg border border-default-200 bg-content1 px-3 py-2 text-small shadow-sm">
            <span role="status">{error ? '差异更新失败' : '待同步最新批次'}</span>
            <button type="button" className="underline" onClick={() => void refresh()}>重试加载差异</button>
        </div>
    )

    if (total === 0 && rejected.length === 0 && !reviewCounts && !adminReview) {
        return (
            <div className="py-8">
                <p className="text-center text-default-500">暂无修改预览</p>
                {fallback}
                {reviewPreviewStatus}
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="flex gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <Chip color="success" variant="flat" size="sm">+{summary.added}</Chip>
                    <span className="text-small text-default-500">新增</span>
                </div>
                <div className="flex items-center gap-2">
                    <Chip color="warning" variant="flat" size="sm">~{summary.modified}</Chip>
                    <span className="text-small text-default-500">修改</span>
                </div>
                <div className="flex items-center gap-2">
                    <Chip color="danger" variant="flat" size="sm">-{summary.deleted}</Chip>
                    <span className="text-small text-default-500">删除</span>
                </div>
                {summary.rejected > 0 && (
                    <div className="flex items-center gap-2">
                        <Chip color="default" variant="flat" size="sm">✖{summary.rejected}</Chip>
                        <span className="text-small text-default-500">被拒绝</span>
                    </div>
                )}
                {reviewCounts && (
                    <div className="ms-auto flex items-center gap-4 whitespace-nowrap text-small tabular-nums text-default-500">
                        <span>待审核 <strong className="inline-block min-w-[3ch] text-end text-default-700">{reviewCounts.pending}</strong></span>
                        <span>已审核 <strong className="inline-block min-w-[3ch] text-end text-default-700">{reviewCounts.reviewed}</strong></span>
                    </div>
                )}
            </div>
            {reviewControls}

            {/* Git diff view */}
            {previewChanges.length > 0 && (() => {
                const grouped = previewChanges.reduce<{ type: string; groups: TypeChangeGroup[] }[]>((acc, group) => {
                    const last = acc[acc.length - 1]
                    if (last && last.type === group.phraseType) {
                        last.groups.push(group)
                    } else {
                        acc.push({ type: group.phraseType, groups: [group] })
                    }
                    return acc
                }, [])
                return (
                    <div className="rounded-lg overflow-hidden border border-[#2a2d3e] bg-[#1a1b2e] divide-y divide-[#2a2d3e]">
                        {grouped.map(({ type, groups }) => (
                            <div key={type}>
                                <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1e2030] border-b border-[#363b54] text-[#7aa2f7] font-mono text-sm">
                                    <span className="text-[#565f89] select-none">diff</span>
                                    <span className="font-bold">{type}</span>
                                </div>
                                {groups.map((group, i) => (
                                    <DiffView key={group.codes.join(',') || i} layout={layouts.get(group)!}
                                        renderLineActions={lineActions}
                                        renderReviewItem={reviewDetail && ((id, remark) => reviewDetail(id, undefined, true, remark))}
                                        getReviewWeight={getReviewWeight} hideMiaomiaoReview={hideMiaomiaoReview}
                                        reorder={onReorder && canReorderItem ? {
                                            drag, pendingId: reorderingId, disabled: outdated || Boolean(stalePublicLines), canMove: canReorderItem,
                                            move: (source, target) => void move(group, source, target),
                                        } : undefined} />
                                ))}
                            </div>
                        ))}
                    </div>
                )
            })()}

            {/* Rejected Operations */}
            {rejected.length > 0 && (
                <div className="rounded-lg border border-default-200 overflow-hidden">
                    <div className="bg-default-100 px-4 py-3 border-b border-default-200 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-warning" />
                        <span className="text-medium font-semibold text-default-700">被拒绝的操作</span>
                        <Chip size="sm" variant="flat">{rejected.length}</Chip>
                        {!adminReview && <span className="text-tiny text-default-500 ml-2">以下操作因冲突将被跳过</span>}
                    </div>
                    <div className="divide-y divide-default-100">
                        {rejected.map(op => reviewDetail ? (
                            <div key={op.prId} className="overflow-x-auto px-3 py-1.5">
                                {reviewDetail(op.prId, publicRejectionReasons ? publicRejectionReasons.get(op.prId) : op.reason)}
                            </div>
                        ) : (
                            <div key={op.prId} className="p-3 flex items-start gap-3">
                                <div className="w-6 h-6 flex items-center justify-center rounded bg-default-200 text-default-600 shrink-0 mt-0.5">
                                    <X className="w-4 h-4" />
                                </div>
                                <div className="flex-1 space-y-1.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Chip size="sm" variant="flat">
                                            {op.action === 'Create' ? '新增' : op.action === 'Change' ? '修改' : '删除'}
                                        </Chip>
                                        <span className="font-semibold text-default-700">{op.word}</span>
                                        {op.oldWord && (
                                            <>
                                                <span className="text-default-400">←</span>
                                                <span className="text-default-500 line-through">{op.oldWord}</span>
                                            </>
                                        )}
                                        <code className="bg-default-200 text-default-700 px-2 py-0.5 rounded text-small font-mono">{op.code}</code>
                                        {lineActions && <div className="ml-auto">{lineActions(op.prId)}</div>}
                                    </div>
                                    <div className="p-2 bg-warning-50 dark:bg-warning-100/10 rounded border-l-2 border-warning">
                                        <p className="text-small text-warning-700 dark:text-warning-600">
                                            <span className="font-semibold">拒绝原因: </span>{op.reason}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {fallback}
            {reviewPreviewStatus}
        </div>
    )
}
