'use client'

import {
    Card,
    CardBody,
    CardHeader,
    Chip,
    Button
} from '@heroui/react'
import CodePhrasesPopover from './CodePhrasesPopover'

interface PullRequest {
    id: number
    word: string | null
    oldWord?: string | null
    code: string | null
    action: string
    weight: number | null
    remark: string | null
    hasConflict: boolean
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
                            <Chip size="sm" variant="flat">
                                {getActionText(pr.action)}
                            </Chip>
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
                            {(pr.conflictInfo?.hasConflict ?? pr.hasConflict) && (
                                <Chip color="warning" size="sm" variant="flat">
                                    ⚠️ 冲突
                                </Chip>
                            )}
                        </div>
                    </CardHeader>
                    <CardBody>
                        {pr.remark && (
                            <div className="mb-3">
                                <p className="text-small text-default-500">备注: {pr.remark}</p>
                            </div>
                        )}

                        {(pr.conflictInfo?.hasConflict ?? pr.hasConflict) && (pr.conflictInfo?.impact || pr.conflictReason) && (
                            <div className="mb-3 p-3 bg-warning-50 dark:bg-warning-100/10 rounded-lg">
                                <p className="text-small text-warning">
                                    {pr.conflictInfo?.impact || pr.conflictReason}
                                </p>
                            </div>
                        )}

                        {pr.conflicts.length > 0 && (
                            <div className="mb-3">
                                <p className="text-small font-medium mb-2">冲突详情:</p>
                                {pr.conflicts.map((conflict, idx) => (
                                    <div key={idx} className="text-small text-default-500 ml-4">
                                        编码 &quot;{conflict.code}&quot; 被 &quot;{conflict.currentWord}&quot; 占用
                                    </div>
                                ))}
                            </div>
                        )}

                        {pr.dependencies.length > 0 && (
                            <div className="mb-3">
                                <p className="text-small font-medium mb-2">依赖于:</p>
                                {pr.dependencies.map((dep, idx) => (
                                    <div key={idx} className="text-small text-default-500 ml-4">
                                        • PR#{dep.dependsOn.id}: {dep.dependsOn.word ?? 'Unknown'} ({dep.reason})
                                    </div>
                                ))}
                            </div>
                        )}

                        {pr.dependedBy && pr.dependedBy.length > 0 && (
                            <div>
                                <p className="text-small font-medium mb-2">被依赖:</p>
                                {pr.dependedBy.map((dep, idx) => (
                                    <div key={idx} className="text-small text-default-500 ml-4">
                                        • PR#{dep.dependent.id}: {dep.dependent.word ?? 'Unknown'} ({dep.reason})
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
