'use client'

import {
    Card,
    CardBody,
    CardHeader,
    Chip,
    Button,
    Tooltip,
} from '@/lib/heroui-compat'
import { AlertTriangle, Bot } from 'lucide-react'
import CodePhrasesPopover from './CodePhrasesPopover'
import { getPhraseTypeLabel, type PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewItem, BatchAiReviewStatus } from '@/lib/types/batchAiReview'

interface PullRequest {
    id: number
    word: string | null
    oldWord?: string | null
    code: string | null
    action: string
    type?: PhraseType | null
    weight: number | null
    remark: string | null
    hasConflict?: boolean
    conflictReason: string | null
    conflictInfo?: {
        hasConflict: boolean
        impact?: string
        suggestions?: Array<{
            action: string
            word?: string
            reason: string
        }>
    }
    phrase?: {
        id: number
        word: string
        code: string
    }
    aiReview?: BatchAiReviewItem
    conflicts: Array<{
        code: string
        currentWord: string | null
        proposedWord: string
    }>
    dependencies: Array<{
        dependsOn: {
            id: number
            word: string | null
            code: string | null
        }
        reason: string
    }>
    dependedBy?: Array<{
        dependent: {
            id: number
            word: string | null
            code: string | null
        }
        reason: string
    }>
}

interface BatchPRListProps {
    pullRequests: PullRequest[]
    canEdit?: boolean
    onAddFirst?: () => void
}

export default function BatchPRList({
    pullRequests,
    canEdit,
    onAddFirst
}: BatchPRListProps) {
    const getActionText = (action: string) => {
        const map: Record<string, string> = {
            Create: '新增',
            Change: '修改',
            Delete: '删除'
        }
        return map[action] || action
    }

    const getActionColor = (action: string): "success" | "warning" | "danger" | "default" => {
        const map: Record<string, "success" | "warning" | "danger"> = {
            Create: 'success',
            Change: 'warning',
            Delete: 'danger'
        }
        return map[action] || 'default'
    }

    const getAiStatusColor = (status: BatchAiReviewStatus): "success" | "warning" | "danger" => {
        const map: Record<BatchAiReviewStatus, "success" | "warning" | "danger"> = {
            pass: 'success',
            attention: 'warning',
            manual_review: 'danger'
        }
        return map[status]
    }

    const getAiStatusText = (status: BatchAiReviewStatus) => {
        const map: Record<BatchAiReviewStatus, string> = {
            pass: '通过',
            attention: '待看',
            manual_review: '人工'
        }
        return map[status]
    }

    const getAiNoticeClass = (status: BatchAiReviewStatus) => {
        if (status === 'manual_review') {
            return 'border-danger-200 bg-danger-50/70 dark:bg-danger-100/10'
        }
        return 'border-warning-200 bg-warning-50/70 dark:bg-warning-100/10'
    }

    if (pullRequests.length === 0) {
        return (
            <Card>
                <CardBody className="text-center py-12">
                    <p className="text-default-500 mb-4">还没有添加任何修改</p>
                    {canEdit && onAddFirst && (
                        <Button color="primary" onPress={onAddFirst}>
                            添加第一个修改
                        </Button>
                    )}
                </CardBody>
            </Card>
        )
    }

    return (
        <div className="space-y-4 pt-4">
            {pullRequests.map((pr) => (
                <Card key={pr.id}>
                    <CardHeader className="flex justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Chip size="sm">{pr.id}</Chip>
                            <Chip size="sm" variant="flat" color={getActionColor(pr.action)}>
                                {getActionText(pr.action)}
                            </Chip>
                            {pr.type && (
                                <Chip size="sm" variant="flat" color="default">
                                    {getPhraseTypeLabel(pr.type)}
                                </Chip>
                            )}
                            {pr.action === 'Change' && pr.oldWord ? (
                                <>
                                    <span className="text-default-500 line-through">{pr.oldWord}</span>
                                    <span className="text-default-500">→</span>
                                    <span className="font-semibold">{pr.word}</span>
                                    <span className="text-default-500">@</span>
                                    <CodePhrasesPopover code={pr.code}>
                                        <code className="text-primary cursor-pointer hover:underline">
                                            {pr.code}
                                        </code>
                                    </CodePhrasesPopover>
                                </>
                            ) : (
                                <>
                                    <span className="font-semibold">
                                        {pr.word || pr.phrase?.word}
                                    </span>
                                    {pr.action !== 'Delete' && (
                                        <>
                                            <span className="text-default-500">→</span>
                                            <CodePhrasesPopover code={pr.code || pr.phrase?.code || null}>
                                                <code className="text-primary cursor-pointer hover:underline">
                                                    {pr.code || pr.phrase?.code}
                                                </code>
                                            </CodePhrasesPopover>
                                        </>
                                    )}
                                    {pr.action === 'Delete' && (
                                        <>
                                            <span className="text-default-500">@</span>
                                            <CodePhrasesPopover code={pr.code || pr.phrase?.code || null}>
                                                <code className="text-primary cursor-pointer hover:underline">
                                                    {pr.code || pr.phrase?.code}
                                                </code>
                                            </CodePhrasesPopover>
                                        </>
                                    )}
                                </>
                            )}
                            {pr.weight ? (
                                <span className="text-small text-default-400">
                                    (权重: {pr.weight})
                                </span>
                            ) : null}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {pr.aiReview?.reviewRecord && (
                                <Tooltip content={pr.aiReview.reviewRecord.summary}>
                                    <Chip color="primary" size="sm" variant="flat" startContent={<Bot className="w-3 h-3" />}>
                                        喵审
                                    </Chip>
                                </Tooltip>
                            )}
                            {pr.aiReview && pr.aiReview.status !== 'pass' && (
                                <Chip color={getAiStatusColor(pr.aiReview.status)} size="sm" variant="flat">
                                    {getAiStatusText(pr.aiReview.status)}
                                </Chip>
                            )}
                            {(pr.conflictInfo?.hasConflict ?? pr.hasConflict) && (
                                <Chip color="warning" size="sm" variant="flat" startContent={<AlertTriangle className="w-3 h-3" />}>
                                    冲突
                                </Chip>
                            )}
                        </div>
                    </CardHeader>
                    <CardBody>
                        {pr.aiReview?.reviewRecord ? (
                            <div className="mb-2 flex flex-wrap items-center gap-1 text-tiny text-default-500">
                                <span className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-primary dark:bg-primary-100/10">
                                    <Bot className="h-3 w-3" />
                                    喵备注
                                </span>
                                {pr.aiReview.reviewRecord.evidence.slice(0, 2).map((evidence, index) => (
                                    <span key={index} className="rounded-md bg-default-100 px-2 py-1 dark:bg-default-100/10">
                                        {evidence}
                                    </span>
                                ))}
                            </div>
                        ) : pr.remark && (
                            <div className="mb-3">
                                <p className="text-small text-default-500">备注: {pr.remark}</p>
                            </div>
                        )}

                        {pr.aiReview && pr.aiReview.status !== 'pass' && (
                            <div className={`mb-3 rounded-md border px-3 py-2 ${getAiNoticeClass(pr.aiReview.status)}`}>
                                <div className="flex items-center gap-2 mb-2">
                                    <AlertTriangle className={`w-4 h-4 ${pr.aiReview.status === 'manual_review' ? 'text-danger' : 'text-warning'}`} />
                                    <p className="text-small font-medium">{pr.aiReview.title}</p>
                                </div>
                                <div className="space-y-1">
                                    {pr.aiReview.reasons.slice(0, 2).map((reason, index) => (
                                        <p key={`reason-${index}`} className="text-small text-default-600">
                                            {reason}
                                        </p>
                                    ))}
                                    {pr.aiReview.suggestions.slice(0, 1).map((suggestion, index) => (
                                        <p key={`suggestion-${index}`} className="text-tiny text-default-500">
                                            建议：{suggestion}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(pr.conflictInfo?.impact || pr.conflictReason) && (
                            <div className="mb-3 p-3 bg-warning-50 dark:bg-warning-100/10 rounded-lg">
                                <p className="text-small text-warning">
                                    {pr.conflictInfo?.impact || pr.conflictReason}
                                </p>
                            </div>
                        )}

                        {pr.dependencies.length > 0 && (
                            <div className="mb-3">
                                <p className="text-small font-medium mb-2">依赖于:</p>
                                {pr.dependencies.map((dep, idx) => (
                                    <div key={idx} className="text-small text-default-500 ml-4">
                                        • PR#{dep.dependsOn.id}: {dep.dependsOn.word ?? 'Unknown'} {dep.reason && <span>{dep.reason}</span>}
                                    </div>
                                ))}
                            </div>
                        )}

                        {pr.dependedBy && pr.dependedBy.length > 0 && (
                            <div>
                                <p className="text-small font-medium mb-2">被依赖:</p>
                                {pr.dependedBy.map((dep, idx) => (
                                    <div key={idx} className="text-small text-default-500 ml-4">
                                        • PR#{dep.dependent.id}: {dep.dependent.word ?? 'Unknown'} {dep.reason && <span>{dep.reason}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardBody>
                </Card>
            ))}
        </div>
    )
}
