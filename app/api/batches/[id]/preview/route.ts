import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

interface PreviewPhrase {
    word: string
    code: string
    type: string
    weight: number
    remark?: string
}

interface DiffItem {
    type: 'add' | 'remove' | 'modify'
    phrase?: PreviewPhrase // for add/remove
    before?: PreviewPhrase // for modify
    after?: PreviewPhrase // for modify
}

interface CodeChangeGroup {
    code: string
    diffs: DiffItem[]
}

interface RejectedOperation {
    prId: number
    action: string
    word: string
    code: string
    oldWord?: string
    reason: string
}

// GET /api/batches/:id/preview - Preview batch execution result
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        const batch = await prisma.batch.findUnique({
            where: { id },
            include: {
                pullRequests: {
                    orderBy: { createAt: 'asc' }
                }
            }
        })

        if (!batch) {
            return NextResponse.json({ error: '批次不存在' }, { status: 404 })
        }

        // 1. Collect all codes involved
        const codes = new Set<string>()
        batch.pullRequests.forEach(pr => {
            if (pr.code) codes.add(pr.code)
        })

        // Early return if no codes to process
        if (codes.size === 0) {
            return NextResponse.json({
                preview: {
                    changes: [],
                    rejected: [],
                    summary: {
                        added: 0,
                        modified: 0,
                        deleted: 0,
                        rejected: 0
                    }
                }
            })
        }

        const isExecuted = ['Approved', 'Published'].includes(batch.status)
        const changes: CodeChangeGroup[] = []
        const rejected: RejectedOperation[] = []
        let addedCount = 0
        let removedCount = 0
        let modifiedCount = 0

        if (isExecuted) {
            // For executed batches, calculate dynamic weights first
            const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')
            const prItems = batch.pullRequests
                .filter(pr => pr.word && pr.code)
                .map(pr => ({
                    id: String(pr.id),
                    action: pr.action,
                    word: pr.word!,
                    code: pr.code!,
                    oldWord: pr.oldWord || undefined,
                    weight: pr.weight || undefined,
                    type: pr.type || 'Phrase',
                }))

            const conflictResults = await checkBatchConflictsWithWeight(prItems)
            const weightMap = new Map<number, number>()
            conflictResults.forEach(result => {
                const prId = parseInt(result.id)
                if (!isNaN(prId) && result.calculatedWeight !== undefined) {
                    weightMap.set(prId, result.calculatedWeight)
                }
            })

            // For executed batches, generate diffs directly from PRs history
            // Group PRs by code
            const prsByCode = new Map<string, typeof batch.pullRequests>()
            batch.pullRequests.forEach(pr => {
                if (!pr.code) return
                if (!prsByCode.has(pr.code)) {
                    prsByCode.set(pr.code, [])
                }
                prsByCode.get(pr.code)!.push(pr)
            })

            const sortedCodes = Array.from(codes).sort()
            for (const code of sortedCodes) {
                const prs = prsByCode.get(code) || []
                const diffs: DiffItem[] = []

                for (const pr of prs) {
                    switch (pr.action) {
                        case 'Create':
                            if (pr.word) {
                                // Use dynamic weight from weightMap
                                const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0
                                diffs.push({
                                    type: 'add',
                                    phrase: {
                                        word: pr.word,
                                        code: code,
                                        type: pr.type || 'Phrase',
                                        weight: finalWeight,
                                        remark: pr.remark || undefined
                                    }
                                })
                                addedCount++
                            }
                            break
                        case 'Change':
                            if (pr.word && pr.oldWord) {
                                // Use dynamic weight from weightMap
                                const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0
                                diffs.push({
                                    type: 'modify',
                                    before: {
                                        word: pr.oldWord,
                                        code: code,
                                        type: 'Unknown', // We don't verify old type in history mode
                                        weight: 0, // We don't verify old weight
                                    },
                                    after: {
                                        word: pr.word,
                                        code: code,
                                        type: pr.type || 'Phrase',
                                        weight: finalWeight,
                                        remark: pr.remark || undefined
                                    }
                                })
                                modifiedCount++
                            }
                            break
                        case 'Delete':
                            if (pr.word) {
                                diffs.push({
                                    type: 'remove',
                                    phrase: {
                                        word: pr.word,
                                        code: code,
                                        type: pr.type || 'Phrase',
                                        weight: 0,
                                        remark: pr.remark || undefined
                                    }
                                })
                                removedCount++
                            }
                            break
                    }
                }
                if (diffs.length > 0) {
                    changes.push({ code, diffs })
                }
            }

        } else {
            // For pending batches, use DB simulation logic with dynamic weight calculation
            // Calculate dynamic weights first
            const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')
            const prItems = batch.pullRequests
                .filter(pr => pr.word && pr.code) // Filter out invalid items
                .map(pr => ({
                    id: String(pr.id),
                    action: pr.action,
                    word: pr.word!,
                    code: pr.code!,
                    oldWord: pr.oldWord || undefined,
                    weight: pr.weight || undefined,
                    type: pr.type || 'Phrase', // Default to 'Phrase' if type is null
                }))
            const conflictResults = await checkBatchConflictsWithWeight(prItems)

            // Create weight map for dynamic weights
            const weightMap = new Map<number, number>()
            // Create conflict map to filter out PRs with unresolved conflicts
            const conflictMap = new Map<number, boolean>()
            conflictResults.forEach(result => {
                const prId = parseInt(result.id)
                if (!isNaN(prId)) {
                    if (result.calculatedWeight !== undefined) {
                        weightMap.set(prId, result.calculatedWeight)
                    }
                    // Check if PR has unresolved conflict
                    const hasUnresolvedConflict = result.conflict.hasConflict &&
                        !result.conflict.suggestions?.some(s => s.action === 'Resolved')
                    conflictMap.set(prId, hasUnresolvedConflict)
                }
            })

            // 2. Fetch current state from DB (Before State)
            const existingPhrases = await prisma.phrase.findMany({
                where: {
                    code: { in: Array.from(codes) }
                }
            })

            // Use Maps to track state during simulation
            const currentState = new Map<string, PreviewPhrase[]>()
            const originalState = new Map<string, PreviewPhrase[]>()

            // Initialize states
            Array.from(codes).forEach(code => {
                const phrases = existingPhrases
                    .filter(p => p.code === code)
                    .map(p => ({
                        word: p.word,
                        code: p.code,
                        type: p.type,
                        weight: p.weight,
                        remark: p.remark || undefined
                    }))

                currentState.set(code, JSON.parse(JSON.stringify(phrases)))
                originalState.set(code, JSON.parse(JSON.stringify(phrases)))
            })

            // 3. Simulate PR execution (After State) with dynamic weights
            // Skip PRs with unresolved conflicts but track them
            for (const pr of batch.pullRequests) {
                if (!pr.code) continue

                // Track PRs with unresolved conflicts
                if (conflictMap.get(pr.id)) {
                    // Find conflict info for this PR
                    const conflictInfo = conflictResults.find(r => parseInt(r.id) === pr.id)
                    const reason = conflictInfo?.conflict.impact ||
                        conflictInfo?.conflict.suggestions?.[0]?.reason ||
                        '存在未解决的冲突'

                    rejected.push({
                        prId: pr.id,
                        action: pr.action,
                        word: pr.word!,
                        code: pr.code,
                        oldWord: pr.oldWord || undefined,
                        reason
                    })
                    continue
                }

                const codePhrases = currentState.get(pr.code) || []

                switch (pr.action) {
                    case 'Create':
                        if (pr.word) {
                            // Check if word+code combination already exists
                            const existingIndex = codePhrases.findIndex(p => p.word === pr.word && p.code === pr.code)
                            if (existingIndex === -1) {
                                // Use dynamic weight from weightMap
                                const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0
                                // Only add if word+code combination doesn't exist
                                codePhrases.push({
                                    word: pr.word,
                                    code: pr.code,
                                    type: pr.type || 'Phrase',
                                    weight: finalWeight,
                                    remark: pr.remark || undefined
                                })
                            }
                        }
                        break

                    case 'Change':
                        if (pr.oldWord && pr.word) {
                            const index = codePhrases.findIndex(p => p.word === pr.oldWord && p.code === pr.code)
                            if (index !== -1) {
                                // Use dynamic weight from weightMap
                                const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? codePhrases[index].weight
                                codePhrases[index] = {
                                    ...codePhrases[index],
                                    word: pr.word,
                                    type: pr.type || codePhrases[index].type,
                                    weight: finalWeight,
                                    remark: pr.remark || codePhrases[index].remark
                                }
                            }
                        }
                        break

                    case 'Delete':
                        if (pr.word) {
                            const index = codePhrases.findIndex(p => p.word === pr.word && p.code === pr.code)
                            if (index !== -1) {
                                codePhrases.splice(index, 1)
                            }
                        }
                        break
                }
                currentState.set(pr.code, codePhrases)
            }

            // 4. Generate Diff grouped by code
            const sortedCodes = Array.from(codes).sort()

            for (const code of sortedCodes) {
                const beforeList = originalState.get(code) || []
                const afterList = currentState.get(code) || []
                const diffs: DiffItem[] = []

                const afterWords = new Set(afterList.map(p => p.word))
                const beforeWords = new Set(beforeList.map(p => p.word))

                // Removed
                beforeList.forEach(p => {
                    if (!afterWords.has(p.word)) {
                        diffs.push({ type: 'remove', phrase: p })
                        removedCount++
                    } else {
                        const newP = afterList.find(ap => ap.word === p.word)
                        if (newP && (p.type !== newP.type || p.weight !== newP.weight || p.remark !== newP.remark)) {
                            diffs.push({ type: 'modify', before: p, after: newP })
                            modifiedCount++
                        }
                    }
                })

                // Added
                afterList.forEach(p => {
                    if (!beforeWords.has(p.word)) {
                        diffs.push({ type: 'add', phrase: p })
                        addedCount++
                    }
                })

                if (diffs.length > 0) {
                    changes.push({ code, diffs })
                }
            }
        }

        return NextResponse.json({
            preview: {
                changes,
                rejected,
                summary: {
                    added: addedCount,
                    modified: modifiedCount,
                    deleted: removedCount,
                    rejected: rejected.length
                }
            }
        })
    } catch (error) {
        console.error('Preview batch error:', error)
        return NextResponse.json({ error: '预览失败' }, { status: 500 })
    }
}
