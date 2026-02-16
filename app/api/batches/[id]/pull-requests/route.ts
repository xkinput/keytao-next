import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { PullRequestType } from '@prisma/client'
import { getDefaultWeight, type PhraseType } from '@/lib/constants/phraseTypes'
import { calculateWeightForType } from '@/lib/services/batchConflictService'

// PUT /api/batches/:id/pull-requests - Batch sync PRs (Create/Update/Delete)
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
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

        if (batch.creatorId !== session.id) {
            return NextResponse.json({ error: '无权限' }, { status: 403 })
        }

        if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
            return NextResponse.json(
                { error: '只能编辑草稿或已拒绝状态的批次' },
                { status: 400 }
            )
        }

        const body = await request.json()
        const { items } = body as {
            items: Array<{
                id?: number
                action: PullRequestType
                word: string
                oldWord?: string
                code: string
                type?: string
                weight?: number
                remark?: string
            }>
        }

        if (!Array.isArray(items)) {
            return NextResponse.json({ error: '数据格式错误' }, { status: 400 })
        }

        // 1. Identify Deletions
        // Items provided in body are the desired state. 
        // PRs in DB but NOT in items should be deleted.
        const inputIds = new Set(items.map(i => i.id).filter(Boolean))
        const existingIds = new Set(batch.pullRequests.map(pr => pr.id))

        const idsToDelete = batch.pullRequests
            .filter(pr => !inputIds.has(pr.id))
            .map(pr => pr.id)

        // 2. Process Upserts (Update & Create)
        // We need to calculate weights dynamically based on the current DB state adjusted by this batch.

        // Cache current DB phrase counts for relevant codes AND types
        const codes = new Set(items.map(i => i.code))
        const types = new Set(items.map(i => i.type).filter(Boolean) as string[])

        const existingPhrases = await prisma.phrase.findMany({
            where: {
                code: { in: Array.from(codes) },
                type: { in: Array.from(types) }
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

        const results = []

        // Execute in transaction
        await prisma.$transaction(async (tx) => {
            // A. Delete removed PRs
            if (idsToDelete.length > 0) {
                await tx.pullRequest.deleteMany({
                    where: { id: { in: idsToDelete } }
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
                        where: { word: searchWord, code: item.code }
                    })
                    if (p) finalPhraseId = p.id
                }

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
                    weight: finalWeight,
                    phraseId: finalPhraseId
                })

                if (item.id) {
                    // Update
                    // Verify item belongs to batch? (Security)
                    // Actually `idsToDelete` logic handles membership check implicitly for removal.
                    // But update ID must prevent updating other's PRs.
                    // We are in a transaction. We can trust ID if we checked ownership?
                    // The Prisma `update` where `{ id, batchId: id }` limits scope.

                    await tx.pullRequest.update({
                        where: { id: item.id, batchId: id }, // Ensure PR belongs to this batch
                        data: {
                            word: item.word,
                            oldWord: item.action === 'Change' ? item.oldWord : null,
                            code: item.code,
                            action: item.action,
                            type: item.type ? (item.type as PhraseType) : undefined,
                            weight: finalWeight || undefined,
                            remark: item.remark || undefined,
                            phraseId: finalPhraseId,
                            hasConflict: conflict.hasConflict,
                            conflictReason: conflict.hasConflict ? conflict.impact : null
                        }
                    })
                } else {
                    // Create
                    await tx.pullRequest.create({
                        data: {
                            batchId: id,
                            userId: session.id,
                            word: item.word,
                            oldWord: item.action === 'Change' ? item.oldWord : undefined,
                            code: item.code,
                            action: item.action,
                            type: item.type ? (item.type as PhraseType) : undefined,
                            weight: finalWeight || undefined,
                            remark: item.remark || undefined,
                            phraseId: finalPhraseId,
                            hasConflict: conflict.hasConflict,
                            conflictReason: conflict.hasConflict ? conflict.impact : undefined
                        }
                    })
                }
            }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Batch sync PRs error:', error)
        return NextResponse.json({ error: '保存失败' }, { status: 500 })
    }
}
