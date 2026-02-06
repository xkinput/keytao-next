'use client'

import { Card, CardBody, Chip, Spinner } from '@heroui/react'
import { useAPI } from '@/lib/hooks/useSWR'
import CodePhrasesPopover from './CodePhrasesPopover'

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

interface CodeChangeGroup {
    code: string
    diffs: DiffItem[]
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
    changes: CodeChangeGroup[]
    rejected: RejectedOperation[]
    summary: PreviewStats
}

interface BatchPreviewProps {
    batchId: string
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
            <Card>
                <CardBody className="text-center py-8">
                    <p className="text-danger">加载预览失败</p>
                    <p className="text-default-500 text-small">{error?.message || '未知错误'}</p>
                </CardBody>
            </Card>
        )
    }

    const { preview } = data
    const { changes, rejected = [], summary } = preview
    const total = summary.added + summary.modified + summary.deleted

    if (total === 0 && rejected.length === 0) {
        return (
            <Card>
                <CardBody className="text-center py-8">
                    <p className="text-default-500">暂无修改预览</p>
                </CardBody>
            </Card>
        )
    }

    return (
        <div className="space-y-4">
            {/* Summary */}
            <Card>
                <CardBody>
                    <div className="flex gap-4 justify-center flex-wrap">
                        <div className="flex items-center gap-2">
                            <Chip color="success" variant="flat" size="sm">+ {summary.added}</Chip>
                            <span className="text-small text-default-500">新增</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Chip color="warning" variant="flat" size="sm">~ {summary.modified}</Chip>
                            <span className="text-small text-default-500">修改</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Chip color="danger" variant="flat" size="sm">- {summary.deleted}</Chip>
                            <span className="text-small text-default-500">删除</span>
                        </div>
                        {summary.rejected > 0 && (
                            <div className="flex items-center gap-2">
                                <Chip color="default" variant="flat" size="sm">✖ {summary.rejected}</Chip>
                                <span className="text-small text-default-500">被拒绝</span>
                            </div>
                        )}
                    </div>
                </CardBody>
            </Card>

            {/* Changes grouped by code */}
            {changes.length > 0 && (
                <div className="space-y-4">
                    {changes.map((group) => (
                        <div key={group.code} className="border border-default-200 rounded-lg overflow-hidden bg-content1 shadow-sm">
                            {/* Header: Code */}
                            <div className="bg-default-100 px-4 py-2 border-b border-default-200 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-small font-medium text-default-600">编码:</span>
                                    <CodePhrasesPopover code={group.code}>
                                        <code className="bg-primary/10 text-primary px-2 py-0.5 rounded font-bold text-medium cursor-pointer hover:bg-primary/20 transition-colors">
                                            {group.code}
                                        </code>
                                    </CodePhrasesPopover>
                                </div>
                            </div>

                            {/* Diffs List */}
                            <div className="divide-y divide-default-100/50">
                                {group.diffs.map((diff, idx) => (
                                    <div key={idx} className="p-3 hover:bg-default-50 transition-colors">

                                        {/* Remove */}
                                        {diff.type === 'remove' && diff.phrase && (
                                            <div className="flex items-center gap-3 text-default-500 line-through opacity-70">
                                                <div className="w-6 h-6 flex items-center justify-center rounded bg-danger/10 text-danger shrink-0">
                                                    -
                                                </div>
                                                <div className="flex-1 flex flex-wrap items-center gap-2">
                                                    <span className="font-medium text-large">{diff.phrase.word}</span>
                                                    <Chip size="sm" variant="flat" className="opacity-70">{diff.phrase.type}</Chip>
                                                    <span className="text-tiny">权重: {diff.phrase.weight}</span>
                                                    {diff.phrase.remark && (
                                                        <span className="text-tiny text-default-400">({diff.phrase.remark})</span>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Add */}
                                        {diff.type === 'add' && diff.phrase && (
                                            <div className="flex items-center gap-3">
                                                <div className="w-6 h-6 flex items-center justify-center rounded bg-success/10 text-success shrink-0 font-bold">
                                                    +
                                                </div>
                                                <div className="flex-1 flex flex-wrap items-center gap-2">
                                                    <span className="font-bold text-large text-success-700 dark:text-success-400">
                                                        {diff.phrase.word}
                                                    </span>
                                                    <Chip size="sm" variant="flat" color="success">{diff.phrase.type}</Chip>
                                                    <span className="text-tiny text-default-600">权重: {diff.phrase.weight}</span>
                                                    {diff.phrase.remark && (
                                                        <span className="text-tiny text-default-500">({diff.phrase.remark})</span>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Modify */}
                                        {diff.type === 'modify' && diff.before && diff.after && (
                                            <div className="flex flex-col gap-2">
                                                {/* Before */}
                                                <div className="flex items-center gap-3 text-default-500 line-through opacity-70">
                                                    <div className="w-6 h-6 flex items-center justify-center rounded bg-warning/10 text-warning shrink-0">
                                                        ~
                                                    </div>
                                                    <div className="flex-1 flex flex-wrap items-center gap-2">
                                                        <span className="font-medium">{diff.before.word}</span>
                                                        <span className="text-tiny">[{diff.before.type}] w:{diff.before.weight}</span>
                                                    </div>
                                                </div>
                                                {/* After */}
                                                <div className="flex items-center gap-3 ml-9">
                                                    <div className="flex-1 flex flex-wrap items-center gap-2">
                                                        <span className="font-bold text-large text-warning-700 dark:text-warning-400">
                                                            {diff.after.word}
                                                        </span>
                                                        <Chip size="sm" variant="flat" color="warning">{diff.after.type}</Chip>
                                                        <span className="text-tiny text-default-600">权重: {diff.after.weight}</span>
                                                        {diff.after.remark && (
                                                            <span className="text-tiny text-default-500">({diff.after.remark})</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Rejected Operations */}
            {rejected.length > 0 && (
                <Card className="border-2 border-default-300">
                    <div className="bg-default-100 px-4 py-3 border-b border-default-200">
                        <div className="flex items-center gap-2">
                            <span className="text-medium font-semibold text-default-700">⚠️ 被拒绝的操作</span>
                            <Chip size="sm" variant="flat">{rejected.length}</Chip>
                        </div>
                        <p className="text-tiny text-default-500 mt-1">以下操作因冲突无法执行，将被跳过</p>
                    </div>
                    <CardBody>
                        <div className="space-y-3">
                            {rejected.map((op, idx) => (
                                <div key={idx} className="p-3 border border-default-200 rounded-lg bg-default-50">
                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 flex items-center justify-center rounded bg-default-200 text-default-600 shrink-0 font-bold">
                                            ✖
                                        </div>
                                        <div className="flex-1 space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Chip size="sm" variant="flat" color="default">
                                                    {op.action === 'Create' ? '新增' : op.action === 'Change' ? '修改' : '删除'}
                                                </Chip>
                                                <span className="font-semibold text-default-700">{op.word}</span>
                                                {op.oldWord && (
                                                    <>
                                                        <span className="text-default-400">←</span>
                                                        <span className="text-default-500 line-through">{op.oldWord}</span>
                                                    </>
                                                )}
                                                <span className="text-default-400">@</span>
                                                <code className="bg-default-200 text-default-700 px-2 py-0.5 rounded text-small font-mono">
                                                    {op.code}
                                                </code>
                                            </div>
                                            <div className="p-2 bg-warning-50 dark:bg-warning-100/10 rounded border-l-3 border-warning">
                                                <p className="text-small text-warning-700 dark:text-warning-600">
                                                    <span className="font-semibold">拒绝原因: </span>{op.reason}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardBody>
                </Card>
            )}
        </div>
    )
}
