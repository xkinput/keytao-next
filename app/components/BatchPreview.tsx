'use client'
import { Chip, Spinner } from '@heroui/react'
import { AlertTriangle, X } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'

interface PreviewPhrase {
    word: string
    code: string
    type: string
    weight: number
    remark?: string
}

interface DiffItem {
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
    if (a.phrase.weight !== b.phrase.weight) return a.phrase.weight - b.phrase.weight

    const codeCmp = a.phrase.code.localeCompare(b.phrase.code)
    if (codeCmp !== 0) return codeCmp

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

function formatPhraseLine(p: PreviewPhrase): string {
    const parts = [p.word.padEnd(12), p.code.padEnd(8), String(p.weight).padEnd(6)]
    if (p.remark) parts.push(p.remark)
    return parts.join('  ')
}

function DiffView({ group }: { group: TypeChangeGroup }) {
    const hunks = group.before.length > 0 || group.after.length > 0
        ? computeUnifiedDiff(group.before, group.after, 3, group.beforeStartLine)
        : []

    const hasFull = hunks.length > 0

    return (
        <div className="font-mono text-sm overflow-x-auto">
            {hasFull ? (
                hunks.map((hunk, hi) => (
                    <div key={hi}>
                        {/* Hunk header */}
                        <div className="px-4 py-1.5 bg-[#1e2030] text-[#7dcfff] border-y border-[#2a2d3e]">
                            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                        </div>
                        {hunk.lines.map((line, li) => {
                            if (line.kind === 'context') {
                                return (
                                    <div key={li} className="flex gap-0 text-[#565f89] hover:bg-[#1e2030]/50">
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a2d3e] shrink-0 text-[#3b4261]">{line.oldLine}</span>
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a2d3e] shrink-0 text-[#3b4261]">{line.newLine}</span>
                                        <span className="px-3 py-1.5 select-none w-6 shrink-0"> </span>
                                        <span className="px-3 py-1.5 text-[#565f89]">{formatPhraseLine(line.phrase)}</span>
                                    </div>
                                )
                            }
                            if (line.kind === 'remove') {
                                return (
                                    <div key={li} className="flex gap-0 bg-[#3d1515]/40 hover:bg-[#3d1515]/60">
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#5a2020] shrink-0 text-[#f7768e] font-semibold">{line.oldLine}</span>
                                        <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#5a2020] shrink-0 text-[#3b4261]"> </span>
                                        <span className="px-3 py-1.5 text-[#f7768e] select-none w-6 shrink-0">-</span>
                                        <span className="px-3 py-1.5 text-[#f7768e]">{formatPhraseLine(line.phrase)}</span>
                                    </div>
                                )
                            }
                            // add
                            return (
                                <div key={li} className="flex gap-0 bg-[#1a3a1a]/40 hover:bg-[#1a3a1a]/60">
                                    <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a5a2a] shrink-0 text-[#3b4261]"> </span>
                                    <span className="w-12 text-right pr-3 py-1.5 select-none border-r border-[#2a5a2a] shrink-0 text-[#9ece6a] font-semibold">{line.newLine}</span>
                                    <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                    <span className="px-3 py-1.5 text-[#9ece6a]">{formatPhraseLine(line.phrase)}</span>
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
                    {group.diffs.map((diff, i) => {
                        if (diff.type === 'remove' && diff.phrase) {
                            return (
                                <div key={i} className="flex gap-0 bg-[#3d1515]/40">
                                    <span className="px-3 py-1.5 text-[#f7768e] select-none w-6 shrink-0">-</span>
                                    <span className="px-3 py-1.5 text-[#f7768e]">{formatPhraseLine(diff.phrase)}</span>
                                </div>
                            )
                        }
                        if (diff.type === 'add' && diff.phrase) {
                            return (
                                <div key={i} className="flex gap-0 bg-[#1a3a1a]/40">
                                    <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                    <span className="px-3 py-1.5 text-[#9ece6a]">{formatPhraseLine(diff.phrase)}</span>
                                </div>
                            )
                        }
                        if (diff.type === 'modify' && diff.before && diff.after) {
                            return (
                                <div key={i}>
                                    <div className="flex gap-0 bg-[#3d1515]/40">
                                        <span className="px-3 py-1.5 text-[#f7768e] select-none w-6 shrink-0">-</span>
                                        <span className="px-3 py-1.5 text-[#f7768e]">{formatPhraseLine(diff.before)}</span>
                                    </div>
                                    <div className="flex gap-0 bg-[#1a3a1a]/40">
                                        <span className="px-3 py-1.5 text-[#9ece6a] select-none w-6 shrink-0">+</span>
                                        <span className="px-3 py-1.5 text-[#9ece6a]">{formatPhraseLine(diff.after)}</span>
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

export default function BatchPreview({ batchId }: BatchPreviewProps) {
    const { data, error, isLoading } = useAPI<{ preview: PreviewResult }>(
        `/api/batches/${batchId}/preview`
    )

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-12">
                <Spinner size="lg" label="加载预览..." />
            </div>
        )
    }

    if (error || !data) {
        return (
            <div className="text-center py-8">
                <p className="text-danger">加载预览失败</p>
                <p className="text-default-500 text-small">{error?.message || '未知错误'}</p>
            </div>
        )
    }

    const { preview } = data
    const { changes, rejected = [], summary } = preview
    const total = summary.added + summary.modified + summary.deleted

    if (total === 0 && rejected.length === 0) {
        return (
            <div className="text-center py-8">
                <p className="text-default-500">暂无修改预览</p>
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
            </div>

            {/* Git diff view */}
            {changes.length > 0 && (() => {
                const grouped = changes.reduce<{ type: string; groups: TypeChangeGroup[] }[]>((acc, group) => {
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
                                    <DiffView key={group.codes.join(',') || i} group={group} />
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
                        <span className="text-tiny text-default-500 ml-2">以下操作因冲突将被跳过</span>
                    </div>
                    <div className="divide-y divide-default-100">
                        {rejected.map((op, idx) => (
                            <div key={idx} className="p-3 flex items-start gap-3">
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
        </div>
    )
}
