'use client'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Chip, Spinner } from '@/lib/heroui-compat'
import { AlertTriangle, Bot, CheckCircle2, X } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'
import { parseMiaomiaoReviewRemark, type MiaomiaoReviewRemarkBlock } from '@/lib/services/miaomiaoReviewRemark'

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
    reviewing?: boolean
    expectedContentVersion?: number
    reviewedFromContentVersion?: number
    reviewCounts?: { pending: number; reviewed: number }
    onNewerReviewPreview?: () => Promise<void>
    renderLineActions?: (itemId: number, stale?: boolean) => ReactNode
    lineActionItems?: readonly { id: number; label: string; code?: string | null }[]
    reviewItems?: readonly { id: number }[]
    renderReviewItem?: (itemId: number, stale: boolean, rejectedReason?: string) => ReactNode
    getReviewWeight?: (itemId: number) => number | undefined
    renderReviewControls?: (outdated: boolean) => ReactNode
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
    if (!hunks.length) {
        return { hunks, actionRows, shownIds: group.diffs.flatMap(diff => diff.itemId === undefined ? [] : [diff.itemId]) }
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
    return { hunks, actionRows, shownIds: [...actionRows.values()] }
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
    const fields = [
        { label: '结论', value: review.conclusion },
        { label: '理由', value: review.reason },
        { label: '建议', value: review.suggestion },
        { label: '读音', value: review.pronunciation },
        { label: '来源', value: review.sources.join('、') || undefined },
        { label: '证据', value: review.evidence.join('；') || undefined },
        { label: '常用', value: review.commonness?.daily },
        { label: '收录', value: review.commonness?.authority },
    ].filter((field): field is { label: string; value: string } => Boolean(field.value))

    return (
        <div className="mt-2 max-w-5xl border-l-2 border-[#7aa2f7] bg-[#16192a] px-3 py-2 font-sans text-xs text-[#a9b1d6]">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-[#7dcfff]" />
                <span className="font-medium text-[#c0caf5]">本喵复审</span>
                {review.status && (
                    <span className={`inline-flex items-center gap-1 ${passed ? 'text-[#9ece6a]' : 'text-[#e0af68]'}`}>
                        {passed ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {review.status}
                    </span>
                )}
                {review.generatedAt && (
                    <span className="ml-auto text-[#565f89]">{formatReviewTime(review.generatedAt)}</span>
                )}
            </div>
            {fields.length > 0 && (
                <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 leading-5">
                    {fields.map(field => (
                        <div key={field.label} className="contents">
                            <span className="text-[#7dcfff]">{field.label}</span>
                            <span className="min-w-0 whitespace-normal break-words text-[#a9b1d6]">{field.value}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function PhraseLineContent({ phrase, colorClass, actions, reviewDetail, reviewWeight }: {
    phrase: PreviewPhrase
    colorClass: string
    actions?: ReactNode
    reviewDetail?: ReactNode
    reviewWeight?: number
}) {
    const parsedRemark = !reviewDetail ? parseMiaomiaoReviewRemark(phrase.remark) : undefined

    return (
        <div className="min-w-0 flex-1 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-x-3">
                <div className={`whitespace-pre ${colorClass}`}>{formatPhraseLine(phrase, reviewWeight)}</div>
                {actions && <div className="ml-auto shrink-0 font-sans text-[#c0caf5]">{actions}</div>}
            </div>
            {parsedRemark?.baseRemark && (
                <div className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-[#737aa2]">
                    {parsedRemark.baseRemark}
                </div>
            )}
            {parsedRemark?.review && <MiaomiaoDiffReview review={parsedRemark.review} />}
            {reviewDetail && <div className="font-sans text-[#c0caf5]">{reviewDetail}</div>}
        </div>
    )
}

function DiffView({ group, layout, renderLineActions, renderReviewItem, getReviewWeight }: {
    group: TypeChangeGroup
    layout: ReturnType<typeof prepareDiff>
    renderLineActions?: BatchPreviewProps['renderLineActions']
    renderReviewItem?: (itemId: number) => ReactNode
    getReviewWeight?: BatchPreviewProps['getReviewWeight']
}) {
    const { hunks, actionRows } = layout
    const hasFull = hunks.length > 0
    const actionsFor = (itemId?: number) => itemId === undefined ? undefined : renderLineActions?.(itemId)
    const detailFor = (itemId?: number) => itemId === undefined ? undefined : renderReviewItem?.(itemId)
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
                                    <div key={key} className="flex gap-0 text-[#565f89] hover:bg-[#1e2030]/50">
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a2d3e] shrink-0 text-[#3b4261]">{line.oldLine}</span>
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a2d3e] shrink-0 text-[#3b4261]">{line.newLine}</span>
                                        <span className="px-3 py-1.5 select-none w-6 shrink-0"> </span>
                                        <PhraseLineContent phrase={line.phrase} colorClass="text-[#565f89]" />
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
                                            actions={actionsFor(itemId)} reviewDetail={detailFor(itemId)} />
                                    </div>
                                )
                            }
                            // add
                            return (
                                <div key={key} className="flex gap-0 bg-[#1a3a1a]/40 hover:bg-[#1a3a1a]/60">
                                    <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a5a2a] shrink-0 text-[#3b4261]"> </span>
                                    <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a5a2a] shrink-0 text-[#9ece6a] font-semibold">{line.newLine}</span>
                                    <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                    <PhraseLineContent phrase={line.phrase} colorClass="text-[#9ece6a]"
                                        actions={actionsFor(itemId)} reviewDetail={detailFor(itemId)} reviewWeight={weightFor(itemId)} />
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
                    {group.diffs.map(diff => {
                        if (diff.type === 'remove' && diff.phrase) {
                            return (
                                <div key={diff.itemId ?? `remove:${phraseKey(diff.phrase)}`} className="flex gap-0 bg-[#3d1515]/40">
                                    <span className="px-3 py-1.5 text-[#f7768e] select-none w-6 shrink-0">-</span>
                                    <PhraseLineContent phrase={diff.phrase} colorClass="text-[#f7768e]"
                                        actions={actionsFor(diff.itemId)} reviewDetail={detailFor(diff.itemId)} />
                                </div>
                            )
                        }
                        if (diff.type === 'add' && diff.phrase) {
                            return (
                                <div key={diff.itemId ?? `add:${phraseKey(diff.phrase)}`} className="flex gap-0 bg-[#1a3a1a]/40">
                                    <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                    <PhraseLineContent phrase={diff.phrase} colorClass="text-[#9ece6a]"
                                        actions={actionsFor(diff.itemId)} reviewDetail={detailFor(diff.itemId)} reviewWeight={weightFor(diff.itemId)} />
                                </div>
                            )
                        }
                        if (diff.type === 'modify' && diff.before && diff.after) {
                            return (
                                <div key={diff.itemId ?? `modify:${phraseKey(diff.after)}`}>
                                    <div className="flex gap-0 bg-[#3d1515]/40">
                                        <span className="px-3 py-1.5 text-[#f7768e] select-none w-6 shrink-0">-</span>
                                        <PhraseLineContent phrase={diff.before} colorClass="text-[#f7768e]" />
                                    </div>
                                    <div className="flex gap-0 bg-[#1a3a1a]/40">
                                        <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                        <PhraseLineContent phrase={diff.after} colorClass="text-[#9ece6a]"
                                            actions={actionsFor(diff.itemId)} reviewDetail={detailFor(diff.itemId)} reviewWeight={weightFor(diff.itemId)} />
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

export default function BatchPreview({ defaultCollapsed = false, ...props }: BatchPreviewProps) {
    const [collapsible] = useState(defaultCollapsed)
    const [expanded, setExpanded] = useState(false)
    if (!collapsible) return <BatchPreviewContent {...props} />

    return (
        <div className="space-y-4">
            <Button type="button" size="sm" variant="flat" aria-expanded={expanded}
                onPress={() => setExpanded(value => !value)}>
                {expanded ? '收起差异' : '展开差异'}
            </Button>
            {expanded && <BatchPreviewContent {...props} />}
        </div>
    )
}

function BatchPreviewContent({
    batchId, reviewing = false, expectedContentVersion, reviewedFromContentVersion, onNewerReviewPreview,
    renderLineActions, lineActionItems, reviewCounts, reviewItems, renderReviewItem, getReviewWeight, renderReviewControls,
}: BatchPreviewProps) {
    const [reviewLayout, setReviewLayout] = useState<PreviewResult>()
    const { data, error, isLoading, isValidating, mutate } = useAPI<{ contentVersion: number; preview: PreviewResult }>(
        `/api/batches/${batchId}/preview${reviewing ? '?review=1' : ''}`,
        { keepPreviousData: false, revalidateOnFocus: !reviewing, revalidateOnReconnect: !reviewing },
    )
    const previewVersion = data?.contentVersion
    const compatibleReviewedVersion = previewVersion !== undefined && expectedContentVersion !== undefined &&
        reviewedFromContentVersion !== undefined &&
        previewVersion >= reviewedFromContentVersion && previewVersion <= expectedContentVersion
    const outdated = Boolean(data && expectedContentVersion !== undefined &&
        previewVersion !== expectedContentVersion && !compatibleReviewedVersion)
    const newerReviewPreview = reviewing && previewVersion !== undefined && expectedContentVersion !== undefined &&
        previewVersion > expectedContentVersion

    const refresh = useCallback(() => newerReviewPreview && onNewerReviewPreview
        ? onNewerReviewPreview()
        : mutate().catch(() => undefined), [newerReviewPreview, onNewerReviewPreview, mutate])
    useEffect(() => {
        if (outdated) void refresh()
    }, [outdated, expectedContentVersion, previewVersion, refresh])

    const adminReview = Boolean(renderReviewItem)
    const compatiblePreview = !outdated ? data?.preview : undefined
    // Review metadata can change hunk membership without changing the items under review.
    if (adminReview && !reviewLayout && compatiblePreview) {
        setReviewLayout({
            ...compatiblePreview,
            rejected: [...(compatiblePreview.rejected ?? [])].sort((a, b) => a.code.localeCompare(b.code) || a.prId - b.prId),
        })
    }
    const preview = adminReview
        ? reviewLayout ?? compatiblePreview
        : reviewing || (!error && !outdated) ? data?.preview : undefined
    const changes = preview?.changes
    const layouts = useMemo(() => new Map(changes?.map(group => [group, prepareDiff(group)])), [changes])
    const lineActions = renderLineActions && ((id: number) => renderLineActions(id, reviewing && outdated))
    const reviewDetail = renderReviewItem && ((id: number, reason?: string) => renderReviewItem(id, outdated, reason))
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

    if (adminReview ? !preview : !data || (error && !reviewing)) {
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

    if (!adminReview && outdated && !reviewing) {
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
            <div className="text-center py-8">
                <p className="text-default-500">暂无修改预览</p>
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
                                    <DiffView key={group.codes.join(',') || i} group={group} layout={layouts.get(group)!}
                                        renderLineActions={lineActions} renderReviewItem={reviewDetail} getReviewWeight={getReviewWeight} />
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
                            <div key={op.prId} className="overflow-x-auto px-3 py-1.5">{reviewDetail(op.prId, op.reason)}</div>
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
