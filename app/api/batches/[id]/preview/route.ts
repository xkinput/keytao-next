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

interface RejectedOperation {
    prId: number
    action: string
    word: string
    code: string
    oldWord?: string
    reason: string
}

function sortPhrases(phrases: PreviewPhrase[]): PreviewPhrase[] {
    return [...phrases].sort((a, b) => {
        if (a.weight !== b.weight) return a.weight - b.weight
        return a.word.localeCompare(b.word, 'zh')
    })
}

const CONTEXT_SIZE = 3
const LARGE_GAP_THRESHOLD = CONTEXT_SIZE * 2

// Split sorted affected codes into clusters separated by large gaps.
// A gap is "large" if it contains more phrases than we can show as context.
async function clusterAffectedCodes(affectedCodes: string[], type: string): Promise<string[][]> {
    if (affectedCodes.length <= 1) return [affectedCodes]
    const gapCounts = await Promise.all(
        affectedCodes.slice(0, -1).map((codeA, i) =>
            prisma.phrase.count({
                where: { code: { gt: codeA, lt: affectedCodes[i + 1] }, type: type as any, status: 'Finish' }
            })
        )
    )
    const clusters: string[][] = []
    let current: string[] = [affectedCodes[0]]
    for (let i = 0; i < gapCounts.length; i++) {
        if (gapCounts[i] > LARGE_GAP_THRESHOLD) {
            clusters.push(current)
            current = [affectedCodes[i + 1]]
        } else {
            current.push(affectedCodes[i + 1])
        }
    }
    clusters.push(current)
    return clusters
}

// Count how many phrases come before `p` in the global sort order (code ASC, weight ASC)
// Only counts same type and Finish status to match the exported phrase library
async function fetchStartLine(p: PreviewPhrase): Promise<number> {
    const count = await prisma.phrase.count({
        where: {
            type: p.type as any,
            status: 'Finish',
            OR: [
                { code: { lt: p.code } },
                { code: p.code, weight: { lt: p.weight } }
            ]
        }
    })
    return count + 1 + 12
}

async function fetchTypeContext(
    affectedCodes: string[], // must be sorted
    type: string
): Promise<{ ctxBefore: PreviewPhrase[]; middlePhrases: Map<string, PreviewPhrase[]>; ctxAfter: PreviewPhrase[] }> {
    const minCode = affectedCodes[0]
    const maxCode = affectedCodes[affectedCodes.length - 1]
    const toPhrase = (p: { word: string; code: string; type: string; weight: number; remark: string | null }): PreviewPhrase => ({
        word: p.word, code: p.code, type: p.type, weight: p.weight, remark: p.remark || undefined
    })
    const sel = { word: true, code: true, type: true, weight: true, remark: true } as const

    // For each gap between consecutive affected codes, fetch CONTEXT_SIZE phrases
    // from each direction — avoids fetching all phrases in a potentially huge range
    const gapPromises: Promise<{ word: string; code: string; type: string; weight: number; remark: string | null }[]>[] = []
    for (let i = 0; i < affectedCodes.length - 1; i++) {
        const codeA = affectedCodes[i]
        const codeB = affectedCodes[i + 1]
        const gapWhere = { code: { gt: codeA, lt: codeB }, type: type as any, status: 'Finish' } as const
        gapPromises.push(
            prisma.phrase.findMany({ where: gapWhere, orderBy: [{ code: 'asc' }, { weight: 'asc' }], take: CONTEXT_SIZE, select: sel }),
            prisma.phrase.findMany({ where: gapWhere, orderBy: [{ code: 'desc' }, { weight: 'desc' }], take: CONTEXT_SIZE, select: sel })
        )
    }

    const [beforeRows, afterRows, ...gapResults] = await Promise.all([
        prisma.phrase.findMany({
            where: { code: { lt: minCode }, type: type as any, status: 'Finish' },
            orderBy: [{ code: 'desc' }, { weight: 'desc' }],
            take: CONTEXT_SIZE,
            select: sel
        }),
        prisma.phrase.findMany({
            where: { code: { gt: maxCode }, type: type as any, status: 'Finish' },
            orderBy: [{ code: 'asc' }, { weight: 'asc' }],
            take: CONTEXT_SIZE,
            select: sel
        }),
        ...gapPromises
    ])

    const middlePhrases = new Map<string, PreviewPhrase[]>()
    for (const rows of gapResults) {
        for (const p of rows) {
            if (!middlePhrases.has(p.code)) middlePhrases.set(p.code, [])
            const bucket = middlePhrases.get(p.code)!
            if (!bucket.find(x => x.word === p.word)) bucket.push(toPhrase(p))
        }
    }

    return {
        ctxBefore: beforeRows.reverse().map(toPhrase),
        middlePhrases,
        ctxAfter: afterRows.map(toPhrase)
    }
}

// GET /api/batches/:id/preview - Preview batch execution result
export async function GET(
    _request: NextRequest,
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

        const codes = new Set<string>()
        batch.pullRequests.forEach(pr => {
            if (pr.code) codes.add(pr.code)
        })

        if (codes.size === 0) {
            return NextResponse.json({
                preview: {
                    changes: [],
                    rejected: [],
                    summary: { added: 0, modified: 0, deleted: 0, rejected: 0 }
                }
            })
        }

        const isExecuted = ['Approved', 'Published'].includes(batch.status)
        const changes: TypeChangeGroup[] = []
        const rejected: RejectedOperation[] = []
        let addedCount = 0
        let removedCount = 0
        let modifiedCount = 0

        if (isExecuted) {
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

            // Fetch current DB state (= after execution)
            const currentPhrases = await prisma.phrase.findMany({
                where: { code: { in: Array.from(codes) } }
            })

            const afterStateMap = new Map<string, PreviewPhrase[]>()
            Array.from(codes).forEach(code => {
                afterStateMap.set(code, sortPhrases(
                    currentPhrases
                        .filter(p => p.code === code)
                        .map(p => ({ word: p.word, code: p.code, type: p.type, weight: p.weight, remark: p.remark || undefined }))
                ))
            })

            // Reconstruct before state by reverse-applying PRs
            const beforeStateMap = new Map<string, PreviewPhrase[]>()
            Array.from(codes).forEach(code => {
                beforeStateMap.set(code, [...(afterStateMap.get(code) || [])])
            })

            for (const pr of batch.pullRequests) {
                if (!pr.code) continue
                const beforeList = beforeStateMap.get(pr.code) || []

                switch (pr.action) {
                    case 'Create':
                        // Reverse: remove the created word from before
                        if (pr.word) {
                            const idx = beforeList.findIndex(p => p.word === pr.word)
                            if (idx !== -1) beforeList.splice(idx, 1)
                        }
                        break
                    case 'Delete':
                        // Reverse: add back the deleted word to before
                        if (pr.word) {
                            beforeList.push({
                                word: pr.word,
                                code: pr.code,
                                type: pr.type || 'Phrase',
                                weight: pr.weight || 0,
                                remark: pr.remark || undefined
                            })
                        }
                        break
                    case 'Change':
                        // Reverse: swap newWord back to oldWord in before
                        if (pr.word && pr.oldWord) {
                            const idx = beforeList.findIndex(p => p.word === pr.word)
                            if (idx !== -1) {
                                beforeList[idx] = { ...beforeList[idx], word: pr.oldWord }
                            }
                        }
                        break
                }
                beforeStateMap.set(pr.code, beforeList)
            }

            // Group PRs by code for diffs
            const prsByCode = new Map<string, typeof batch.pullRequests>()
            batch.pullRequests.forEach(pr => {
                if (!pr.code) return
                if (!prsByCode.has(pr.code)) prsByCode.set(pr.code, [])
                prsByCode.get(pr.code)!.push(pr)
            })

            // Group affected codes by type
            const typeCodeMapEx = new Map<string, Set<string>>()
            batch.pullRequests.forEach(pr => {
                if (!pr.code) return
                const t = pr.type || 'Phrase'
                if (!typeCodeMapEx.has(t)) typeCodeMapEx.set(t, new Set())
                typeCodeMapEx.get(t)!.add(pr.code)
            })

            for (const [phraseType, codeSet] of typeCodeMapEx) {
                const affectedCodes = Array.from(codeSet).sort()
                const diffs: DiffItem[] = []

                for (const code of affectedCodes) {
                    const prs = prsByCode.get(code) || []
                    for (const pr of prs) {
                        switch (pr.action) {
                            case 'Create':
                                if (pr.word) {
                                    const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0
                                    diffs.push({ type: 'add', phrase: { word: pr.word, code, type: pr.type || 'Phrase', weight: finalWeight, remark: pr.remark || undefined } })
                                    addedCount++
                                }
                                break
                            case 'Change':
                                if (pr.word && pr.oldWord) {
                                    const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0
                                    diffs.push({ type: 'modify', before: { word: pr.oldWord, code, type: 'Phrase', weight: 0 }, after: { word: pr.word, code, type: pr.type || 'Phrase', weight: finalWeight, remark: pr.remark || undefined } })
                                    modifiedCount++
                                }
                                break
                            case 'Delete':
                                if (pr.word) {
                                    diffs.push({ type: 'remove', phrase: { word: pr.word, code, type: pr.type || 'Phrase', weight: 0, remark: pr.remark || undefined } })
                                    removedCount++
                                }
                                break
                        }
                    }
                }

                if (diffs.length > 0) {
                    const clusters = await clusterAffectedCodes(affectedCodes, phraseType)
                    for (const cluster of clusters) {
                        const clusterSet = new Set(cluster)
                        const clusterDiffs = diffs.filter(d => {
                            const code = d.phrase?.code ?? d.after?.code ?? d.before?.code
                            return code && clusterSet.has(code)
                        })
                        if (clusterDiffs.length === 0) continue
                        const { ctxBefore, middlePhrases, ctxAfter } = await fetchTypeContext(cluster, phraseType)
                        const allCodesInRange = new Set([...cluster, ...middlePhrases.keys()])
                        const sortedRange = Array.from(allCodesInRange).sort()
                        const beforeArr: PreviewPhrase[] = [...ctxBefore]
                        const afterArr: PreviewPhrase[] = [...ctxBefore]
                        for (const code of sortedRange) {
                            if (clusterSet.has(code)) {
                                beforeArr.push(...sortPhrases((beforeStateMap.get(code) || []).filter(p => p.type === phraseType)))
                                afterArr.push(...sortPhrases((afterStateMap.get(code) || []).filter(p => p.type === phraseType)))
                            } else {
                                const middle = sortPhrases(middlePhrases.get(code) || [])
                                beforeArr.push(...middle)
                                afterArr.push(...middle)
                            }
                        }
                        beforeArr.push(...ctxAfter)
                        afterArr.push(...ctxAfter)
                        const firstPhrase = beforeArr[0] ?? afterArr[0]
                        const beforeStartLine = firstPhrase ? await fetchStartLine(firstPhrase) : 1
                        changes.push({ phraseType, codes: cluster, diffs: clusterDiffs, before: beforeArr, after: afterArr, beforeStartLine })
                    }
                }
            }

        } else {
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
            const conflictMap = new Map<number, boolean>()
            conflictResults.forEach(result => {
                const prId = parseInt(result.id)
                if (!isNaN(prId)) {
                    if (result.calculatedWeight !== undefined) {
                        weightMap.set(prId, result.calculatedWeight)
                    }
                    const hasUnresolvedConflict = result.conflict.hasConflict &&
                        !result.conflict.suggestions?.some(s => s.action === 'Resolved')
                    conflictMap.set(prId, hasUnresolvedConflict)
                }
            })

            const existingPhrases = await prisma.phrase.findMany({
                where: { code: { in: Array.from(codes) } }
            })

            const currentState = new Map<string, PreviewPhrase[]>()
            const originalState = new Map<string, PreviewPhrase[]>()

            Array.from(codes).forEach(code => {
                const phrases = existingPhrases
                    .filter(p => p.code === code)
                    .map(p => ({ word: p.word, code: p.code, type: p.type, weight: p.weight, remark: p.remark || undefined }))

                currentState.set(code, JSON.parse(JSON.stringify(phrases)))
                originalState.set(code, JSON.parse(JSON.stringify(phrases)))
            })

            for (const pr of batch.pullRequests) {
                if (!pr.code) continue

                if (conflictMap.get(pr.id)) {
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
                            const existingIndex = codePhrases.findIndex(p => p.word === pr.word && p.code === pr.code)
                            if (existingIndex === -1) {
                                const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0
                                codePhrases.push({ word: pr.word, code: pr.code, type: pr.type || 'Phrase', weight: finalWeight, remark: pr.remark || undefined })
                            }
                        }
                        break
                    case 'Change':
                        if (pr.oldWord && pr.word) {
                            const index = codePhrases.findIndex(p => p.word === pr.oldWord && p.code === pr.code)
                            if (index !== -1) {
                                const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? codePhrases[index].weight
                                codePhrases[index] = { ...codePhrases[index], word: pr.word, type: pr.type || codePhrases[index].type, weight: finalWeight, remark: pr.remark || codePhrases[index].remark }
                            }
                        }
                        break
                    case 'Delete':
                        if (pr.word) {
                            const index = codePhrases.findIndex(p => p.word === pr.word && p.code === pr.code)
                            if (index !== -1) codePhrases.splice(index, 1)
                        }
                        break
                }
                currentState.set(pr.code, codePhrases)
            }

            // Group affected codes by type
            const typeCodeMapPend = new Map<string, Set<string>>()
            batch.pullRequests.forEach(pr => {
                if (!pr.code || conflictMap.get(pr.id)) return
                const t = pr.type || 'Phrase'
                if (!typeCodeMapPend.has(t)) typeCodeMapPend.set(t, new Set())
                typeCodeMapPend.get(t)!.add(pr.code)
            })

            for (const [phraseType, codeSet] of typeCodeMapPend) {
                const affectedCodes = Array.from(codeSet).sort()
                const diffs: DiffItem[] = []

                for (const code of affectedCodes) {
                    const beforeList = originalState.get(code) || []
                    const afterList = currentState.get(code) || []
                    const afterWords = new Set(afterList.map(p => p.word))
                    const beforeWords = new Set(beforeList.map(p => p.word))

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

                    afterList.forEach(p => {
                        if (!beforeWords.has(p.word)) {
                            diffs.push({ type: 'add', phrase: p })
                            addedCount++
                        }
                    })
                }

                if (diffs.length > 0) {
                    const clusters = await clusterAffectedCodes(affectedCodes, phraseType)
                    for (const cluster of clusters) {
                        const clusterSet = new Set(cluster)
                        const clusterDiffs = diffs.filter(d => {
                            const code = d.phrase?.code ?? d.after?.code ?? d.before?.code
                            return code && clusterSet.has(code)
                        })
                        if (clusterDiffs.length === 0) continue
                        const { ctxBefore, middlePhrases, ctxAfter } = await fetchTypeContext(cluster, phraseType)
                        const allCodesInRange = new Set([...cluster, ...middlePhrases.keys()])
                        const sortedRange = Array.from(allCodesInRange).sort()
                        const beforeArr: PreviewPhrase[] = [...ctxBefore]
                        const afterArr: PreviewPhrase[] = [...ctxBefore]
                        for (const code of sortedRange) {
                            if (clusterSet.has(code)) {
                                beforeArr.push(...sortPhrases(originalState.get(code) || []))
                                afterArr.push(...sortPhrases(currentState.get(code) || []))
                            } else {
                                const middle = sortPhrases(middlePhrases.get(code) || [])
                                beforeArr.push(...middle)
                                afterArr.push(...middle)
                            }
                        }
                        beforeArr.push(...ctxAfter)
                        afterArr.push(...ctxAfter)
                        const firstPhrase = beforeArr[0] ?? afterArr[0]
                        const beforeStartLine = firstPhrase ? await fetchStartLine(firstPhrase) : 1
                        changes.push({ phraseType, codes: cluster, diffs: clusterDiffs, before: beforeArr, after: afterArr, beforeStartLine })
                    }
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
