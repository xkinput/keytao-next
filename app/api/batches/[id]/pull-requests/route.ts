import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { PullRequestType, PhraseType as PrismaPhraseType } from '@prisma/client'
import { isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'
import { calculateWeightForType } from '@/lib/services/batchConflictService'
import { checkIsAdmin } from '@/lib/adminAuth'
import { resolvePhraseTargetBinding } from '@/lib/services/phraseTargetBinding'
import { BatchContentLockedError, claimBatchContentMutation } from '@/lib/services/batchContentGuard'

const allowedActions = ['Create', 'Change', 'Delete'] as const

type RawBatchSyncItem = {
    id?: unknown
    action?: unknown
    word?: unknown
    oldWord?: unknown
    code?: unknown
    type?: unknown
    weight?: unknown
    remark?: unknown
}

type BatchSyncItem = {
    id?: number
    action: PullRequestType
    word: string
    oldWord?: string
    code: string
    type?: PhraseType
    weight?: number
    remark?: string | null
}

class BatchSyncInputError extends Error {
    status = 400
}

function parseOptionalPositiveInt(value: unknown): number | undefined | null {
    if (value === undefined || value === null || value === '') return undefined
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseOptionalInt(value: unknown): number | undefined | null {
    if (value === undefined || value === null || value === '') return undefined
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isInteger(parsed) ? parsed : null
}

function isAllowedAction(action: unknown): action is PullRequestType {
    return typeof action === 'string' && allowedActions.includes(action as typeof allowedActions[number])
}

// PUT /api/batches/:id/pull-requests - Batch sync PRs (Create/Update/Delete)
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const maxItems = 500
        const maxWordLength = 100
        const maxCodeLength = 20
        const maxRemarkLength = 500
        const { id } = await params
        const session = await getSession()
        if (!session) {
            return NextResponse.json({ error: '未登录' }, { status: 401 })
        }

        const batch = await prisma.batch.findUnique({
            where: { id },
            include: { pullRequests: true }
        })

        if (!batch) {
            return NextResponse.json({ error: '批次不存在' }, { status: 404 })
        }

        const isAdmin = await checkIsAdmin(session.id)
        if (batch.creatorId !== session.id && !isAdmin) {
            return NextResponse.json({ error: '无权限' }, { status: 403 })
        }

        const allowedStatuses = isAdmin ? ['Draft', 'Rejected', 'Submitted'] : ['Draft', 'Rejected']
        if (!allowedStatuses.includes(batch.status)) {
            return NextResponse.json(
                { error: '只能编辑草稿或已拒绝状态的批次' },
                { status: 400 }
            )
        }

        const body = await request.json()
        const rawItems = (body as { items?: unknown }).items
        const expectedContentVersion = (body as { expectedContentVersion?: unknown }).expectedContentVersion

        if (
            !Number.isInteger(expectedContentVersion)
            || (expectedContentVersion as number) < 0
        ) {
            return NextResponse.json(
                { error: '批次版本缺失或无效，请刷新后重试' },
                { status: 409 }
            )
        }

        if (!Array.isArray(rawItems)) {
            return NextResponse.json({ error: '数据格式错误' }, { status: 400 })
        }

        if (rawItems.length > maxItems) {
            return NextResponse.json({ error: `一次最多保存 ${maxItems} 个条目` }, { status: 400 })
        }

        const items: BatchSyncItem[] = []
        for (const rawItem of rawItems) {
            if (!rawItem || typeof rawItem !== 'object') {
                return NextResponse.json({ error: '数据格式错误' }, { status: 400 })
            }

            const item = rawItem as RawBatchSyncItem
            const itemId = parseOptionalPositiveInt(item.id)
            const weight = parseOptionalInt(item.weight)
            const word = typeof item.word === 'string' ? item.word.trim() : ''
            const code = typeof item.code === 'string' ? item.code.trim() : ''
            const oldWord = typeof item.oldWord === 'string' ? item.oldWord.trim() : undefined
            const type = typeof item.type === 'string' && item.type ? item.type : undefined
            const remark = item.remark === undefined
                ? undefined
                : item.remark === null
                    ? null
                    : typeof item.remark === 'string'
                        ? item.remark
                        : undefined

            if (
                itemId === null ||
                weight === null ||
                !isAllowedAction(item.action) ||
                word.length === 0 ||
                code.length === 0 ||
                word.length > maxWordLength ||
                code.length > maxCodeLength ||
                (item.oldWord !== undefined && item.oldWord !== null && typeof item.oldWord !== 'string') ||
                (oldWord !== undefined && oldWord.length > maxWordLength) ||
                (type !== undefined && !isValidPhraseType(type)) ||
                (item.remark !== undefined && item.remark !== null && typeof item.remark !== 'string') ||
                (typeof remark === 'string' && remark.length > maxRemarkLength)
            ) {
                return NextResponse.json({ error: '词条、编码或备注格式错误' }, { status: 400 })
            }

            items.push({
                id: itemId,
                action: item.action,
                word,
                oldWord,
                code,
                type,
                weight,
                remark
            })
        }

        const batchPullRequestIds = new Set(batch.pullRequests.map(pr => pr.id))
        const invalidItem = items.find(item => item.id !== undefined && !batchPullRequestIds.has(item.id))
        if (invalidItem) {
            return NextResponse.json({ error: '修改项不存在或不属于此批次' }, { status: 400 })
        }

        // 1. Identify Deletions
        // Items provided in body are the desired state. 
        // PRs in DB but NOT in items should be deleted.
        const inputIds = new Set(items.map(i => i.id).filter((itemId): itemId is number => itemId !== undefined))

        const idsToDelete = batch.pullRequests
            .filter(pr => !inputIds.has(pr.id))
            .map(pr => pr.id)

        // 2. Process Upserts (Update & Create)
        // We need to calculate weights dynamically based on the current DB state adjusted by this batch.

        // Cache current DB phrase counts for relevant codes AND types
        const codes = new Set(items.map(i => i.code))
        const types = new Set(items.map(i => i.type).filter(Boolean) as PhraseType[])

        const existingPhrases = await prisma.phrase.findMany({
            where: {
                code: { in: Array.from(codes) },
                type: { in: Array.from(types) as PhraseType[] }
            },
            select: { code: true, type: true, word: true }
        })

        // Group by code+type combination
        const dbPhrasesMap = new Map<string, string[]>()
        existingPhrases.forEach(p => {
            const key = `${p.code}:${p.type}`
            const list = dbPhrasesMap.get(key) || []
            list.push(p.word)
            dbPhrasesMap.set(key, list)
        })

        // Execute in transaction
        await prisma.$transaction(async (tx) => {
            await claimBatchContentMutation(tx, id, {
                expectedContentVersion: expectedContentVersion as number,
                allowedStatuses,
            })

            // A. Delete removed PRs
            if (idsToDelete.length > 0) {
                await tx.pullRequest.deleteMany({
                    where: { id: { in: idsToDelete }, batchId: id }
                })
            }

            // B. Upsert Items
            // We process items sequentially to track "virtual" weight usage within the batch
            // (Though weight is mostly relevant for Create)

            // Track which words are being removed by this batch (Delete/Change actions)
            // Map<Code:Type, Set<Word>>
            const batchRemovals = new Map<string, Set<string>>()
            items.forEach(item => {
                if (!item.type) return
                const key = `${item.code}:${item.type}`

                if (item.action === 'Delete' && item.word) {
                    const set = batchRemovals.get(key) || new Set()
                    set.add(item.word)
                    batchRemovals.set(key, set)
                }
                if (item.action === 'Change' && item.oldWord) {
                    const set = batchRemovals.get(key) || new Set()
                    set.add(item.oldWord)
                    batchRemovals.set(key, set)
                }
            })

            // Track newly added words to properly increment weight if multiple additions to same code+type
            const batchAdditions = new Map<string, number>() // Code:Type -> Count of *new* items added

            for (const item of items) {
                // Find Phrase ID if possible (for Change/Delete)
                let finalPhraseId: number | undefined
                if ((item.action === 'Change' || item.action === 'Delete')) {
                    const searchWord = item.action === 'Change' ? item.oldWord : item.word
                    const p = await tx.phrase.findFirst({
                        where: { word: searchWord, code: item.code, type: (item.type as PrismaPhraseType | undefined) || undefined }
                    })
                    if (p) finalPhraseId = p.id
                }

                const binding = await resolvePhraseTargetBinding(tx.phrase, {
                    ...item,
                    phraseId: finalPhraseId,
                })

                // Calculate Weight
                let finalWeight = item.weight
                if (item.action === 'Create' && item.type) {
                    // Only auto-calc if weight is NOT provided
                    if (finalWeight === undefined || finalWeight === null) {
                        const codeTypeKey = `${item.code}:${item.type}`
                        const baseList = dbPhrasesMap.get(codeTypeKey) || []
                        const initialCount = baseList.length

                        // Count how many base phrases are removed by this batch
                        const removedWords = batchRemovals.get(codeTypeKey)
                        let removedCount = 0
                        if (removedWords) {
                            // Count overlap between DB phrases and Batch Removals
                            removedCount = baseList.filter(w => removedWords.has(w)).length
                        }

                        // Count how many we have already added in this loop
                        const alreadyAddedCount = batchAdditions.get(codeTypeKey) || 0

                        const effectiveCount = initialCount - removedCount + alreadyAddedCount

                        // Use unified weight calculation function
                        finalWeight = calculateWeightForType(item.type as PhraseType, effectiveCount)

                        // Setup for next item
                        batchAdditions.set(codeTypeKey, alreadyAddedCount + 1)
                    }
                }

                // Check Conflict (Optional: lightweight check or skip, rely on separate validation endpoint? 
                // User just wants to save. We can save conflict status.)
                const conflict = await conflictDetector.checkConflict({
                    action: item.action,
                    word: item.word,
                    oldWord: item.oldWord,
                    code: item.code,
                    type: item.type ? (item.type as PrismaPhraseType) : undefined,
                    weight: finalWeight,
                    phraseId: finalPhraseId
                })

                if (item.id) {
                    const result = await tx.pullRequest.updateMany({
                        where: { id: item.id, batchId: id },
                        data: {
                            word: item.word,
                            oldWord: item.action === 'Change' ? item.oldWord : null,
                            code: item.code,
                            action: item.action,
                            type: item.type ? (item.type as PrismaPhraseType) : undefined,
                            weight: finalWeight ?? undefined,
                            remark: item.remark !== undefined ? (item.remark || null) : undefined,
                            phraseId: finalPhraseId,
                            targetPhraseId: binding.targetPhraseId,
                            targetFingerprint: binding.targetFingerprint,
                            hasConflict: conflict.hasConflict,
                            conflictReason: conflict.hasConflict ? conflict.impact : null
                        }
                    })

                    if (result.count !== 1) {
                        throw new BatchSyncInputError('修改项不存在或不属于此批次')
                    }
                } else {
                    // Create
                    await tx.pullRequest.create({
                        data: {
                            batchId: id,
                            userId: batch.creatorId,
                            word: item.word,
                            oldWord: item.action === 'Change' ? item.oldWord : undefined,
                            code: item.code,
                            action: item.action,
                            type: item.type ? (item.type as PrismaPhraseType) : undefined,
                            weight: finalWeight ?? undefined,
                            remark: item.remark || null,
                            phraseId: finalPhraseId,
                            targetPhraseId: binding.targetPhraseId,
                            targetFingerprint: binding.targetFingerprint,
                            hasConflict: conflict.hasConflict,
                            conflictReason: conflict.hasConflict ? conflict.impact : undefined
                        }
                    })
                }
            }
        })

        return NextResponse.json({
            success: true,
            contentVersion: (expectedContentVersion as number) + 1,
        })
    } catch (error) {
        if (error instanceof BatchSyncInputError) {
            return NextResponse.json({ error: error.message }, { status: error.status })
        }
        if (error instanceof BatchContentLockedError) {
            return NextResponse.json({ error: error.message }, { status: error.status })
        }

        console.error('Batch sync PRs error:', error)
        return NextResponse.json({ error: '保存失败' }, { status: 500 })
    }
}
