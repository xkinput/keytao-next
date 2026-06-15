import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/adminAuth'
import type { PhraseType } from '@/lib/constants/phraseTypes'

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

function stateKey(type: string, code: string): string {
    return `${type}\u0000${code}`
}

function clonePhrases(phrases: PreviewPhrase[]): PreviewPhrase[] {
    return phrases.map(p => ({ ...p }))
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
                where: { code: { gt: codeA, lt: affectedCodes[i + 1] }, type: type as PhraseType, status: 'Finish' }
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
            type: p.type as PhraseType,
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
        const gapWhere = { code: { gt: codeA, lt: codeB }, type: type as PhraseType, status: 'Finish' } as const
        gapPromises.push(
            prisma.phrase.findMany({ where: gapWhere, orderBy: [{ code: 'asc' }, { weight: 'asc' }], take: CONTEXT_SIZE, select: sel }),
            prisma.phrase.findMany({ where: gapWhere, orderBy: [{ code: 'desc' }, { weight: 'desc' }], take: CONTEXT_SIZE, select: sel })
        )
    }

    const [beforeRows, afterRows, ...gapResults] = await Promise.all([
        prisma.phrase.findMany({
            where: { code: { lt: minCode }, type: type as PhraseType, status: 'Finish' },
            orderBy: [{ code: 'desc' }, { weight: 'desc' }],
            take: CONTEXT_SIZE,
            select: sel
        }),
        prisma.phrase.findMany({
            where: { code: { gt: maxCode }, type: type as PhraseType, status: 'Finish' },
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

        const isPublicStatus = ['Submitted', 'Approved', 'Published'].includes(batch.status)
        if (!isPublicStatus) {
            const session = await getSession()
            if (!session) {
                return NextResponse.json({ error: '未登录' }, { status: 401 })
            }
            const isAdmin = await checkIsAdmin(session.id)
            if (batch.creatorId !== session.id && !isAdmin) {
                return NextResponse.json({ error: '无权限' }, { status: 403 })
            }
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
            currentPhrases.forEach(p => {
                const key = stateKey(p.type, p.code)
                const list = afterStateMap.get(key) || []
                list.push({ word: p.word, code: p.code, type: p.type, weight: p.weight, remark: p.remark || undefined })
                afterStateMap.set(key, list)
            })
            afterStateMap.forEach((phrases, key) => afterStateMap.set(key, sortPhrases(phrases)))

            batch.pullRequests.forEach(pr => {
                if (!pr.code) return
                const key = stateKey(pr.type || 'Phrase', pr.code)
                if (!afterStateMap.has(key)) afterStateMap.set(key, [])
            })

            // Reconstruct before state by reverse-applying PRs
            const beforeStateMap = new Map<string, PreviewPhrase[]>()
            afterStateMap.forEach((phrases, key) => beforeStateMap.set(key, clonePhrases(phrases)))

            for (const pr of batch.pullRequests) {
                if (!pr.code) continue
                const prType = pr.type || 'Phrase'
                const key = stateKey(prType, pr.code)
                const beforeList = beforeStateMap.get(key) || []

                switch (pr.action) {
                    case 'Create':
                        // Reverse: remove the created word from before
                        if (pr.word) {
                            const idx = beforeList.findIndex(p => p.word === pr.word && p.code === pr.code && p.type === prType)
                            if (idx !== -1) beforeList.splice(idx, 1)
                        }
                        break
                    case 'Delete':
                        // Reverse: add back the deleted word to before
                        if (pr.word) {
                            beforeList.push({
                                word: pr.word,
                                code: pr.code,
                                type: prType,
                                weight: pr.weight || 0,
                                remark: pr.remark || undefined
                            })
                        }
                        break
                    case 'Change':
                        // Reverse: swap newWord back to oldWord in before
                        if (pr.word && pr.oldWord) {
                            const idx = beforeList.findIndex(p => p.word === pr.word && p.code === pr.code && p.type === prType)
                            if (idx !== -1) {
                                beforeList[idx] = { ...beforeList[idx], word: pr.oldWord }
                            }
                        }
                        break
                }
                beforeStateMap.set(key, beforeList)
            }

            // Group PRs by type+code for diffs; identical codes in different dictionaries must stay separate.
            const prsByTypeCode = new Map<string, typeof batch.pullRequests>()
            batch.pullRequests.forEach(pr => {
                if (!pr.code) return
                const key = stateKey(pr.type || 'Phrase', pr.code)
                if (!prsByTypeCode.has(key)) prsByTypeCode.set(key, [])
                prsByTypeCode.get(key)!.push(pr)
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
                    const prs = prsByTypeCode.get(stateKey(phraseType, code)) || []
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
                                    diffs.push({ type: 'modify', before: { word: pr.oldWord, code, type: pr.type || 'Phrase', weight: 0 }, after: { word: pr.word, code, type: pr.type || 'Phrase', weight: finalWeight, remark: pr.remark || undefined } })
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
                                beforeArr.push(...sortPhrases(beforeStateMap.get(stateKey(phraseType, code)) || []))
                                afterArr.push(...sortPhrases(afterStateMap.get(stateKey(phraseType, code)) || []))
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

            existingPhrases.forEach(p => {
                const key = stateKey(p.type, p.code)
                const phrase = { word: p.word, code: p.code, type: p.type, weight: p.weight, remark: p.remark || undefined }
                currentState.set(key, [...(currentState.get(key) || []), phrase])
                originalState.set(key, [...(originalState.get(key) || []), { ...phrase }])
            })

            batch.pullRequests.forEach(pr => {
                if (!pr.code) return
                const key = stateKey(pr.type || 'Phrase', pr.code)
                if (!currentState.has(key)) currentState.set(key, [])
                if (!originalState.has(key)) originalState.set(key, [])
            })

            for (const pr of batch.pullRequests) {
                if (!pr.code) continue
                const prType = pr.type || 'Phrase'
                const key = stateKey(prType, pr.code)

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

                const codePhrases = currentState.get(key) || []

                switch (pr.action) {
                    case 'Create':
                        if (pr.word) {
                            const existingIndex = codePhrases.findIndex(p => p.word === pr.word && p.code === pr.code && p.type === prType)
                            if (existingIndex === -1) {
                                const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0
                                codePhrases.push({ word: pr.word, code: pr.code, type: prType, weight: finalWeight, remark: pr.remark || undefined })
                            }
                        }
                        break
                    case 'Change':
                        if (pr.oldWord && pr.word) {
                            const index = codePhrases.findIndex(p => p.word === pr.oldWord && p.code === pr.code && p.type === prType)
                            const originalList = originalState.get(key) || []
                            const originalPhrase = originalList.find(p => p.word === pr.oldWord && p.code === pr.code && p.type === prType)
                            const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? originalPhrase?.weight ?? codePhrases[index]?.weight ?? 0
                            if (index !== -1) {
                                codePhrases[index] = { ...codePhrases[index], word: pr.word, type: prType, weight: finalWeight, remark: pr.remark || codePhrases[index].remark }
                            } else {
                                if (!originalPhrase) {
                                    originalList.push({
                                        word: pr.oldWord,
                                        code: pr.code,
                                        type: prType,
                                        weight: finalWeight,
                                        remark: pr.remark || undefined
                                    })
                                    originalState.set(key, originalList)
                                }
                                codePhrases.push({
                                    word: pr.word,
                                    code: pr.code,
                                    type: prType,
                                    weight: finalWeight,
                                    remark: pr.remark || undefined
                                })
                            }
                        }
                        break
                    case 'Delete':
                        if (pr.word) {
                            const index = codePhrases.findIndex(p => p.word === pr.word && p.code === pr.code && p.type === prType)
                            if (index !== -1) codePhrases.splice(index, 1)
                        }
                        break
                }
                currentState.set(key, codePhrases)
            }

            const prsByTypeCodePend = new Map<string, typeof batch.pullRequests>()
            batch.pullRequests.forEach(pr => {
                if (!pr.code || conflictMap.get(pr.id)) return
                const key = stateKey(pr.type || 'Phrase', pr.code)
                if (!prsByTypeCodePend.has(key)) prsByTypeCodePend.set(key, [])
                prsByTypeCodePend.get(key)!.push(pr)
            })

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
                    const beforeList = originalState.get(stateKey(phraseType, code)) || []
                    const afterList = currentState.get(stateKey(phraseType, code)) || []
                    const prs = prsByTypeCodePend.get(stateKey(phraseType, code)) || []

                    for (const pr of prs) {
                        switch (pr.action) {
                            case 'Create':
                                if (pr.word) {
                                    const phrase = afterList.find(p => p.word === pr.word && p.code === code && p.type === phraseType) || {
                                        word: pr.word,
                                        code,
                                        type: phraseType,
                                        weight: weightMap.get(pr.id) ?? pr.weight ?? 0,
                                        remark: pr.remark || undefined
                                    }
                                    diffs.push({ type: 'add', phrase })
                                    addedCount++
                                }
                                break
                            case 'Change':
                                if (pr.oldWord && pr.word) {
                                    const before = beforeList.find(p => p.word === pr.oldWord && p.code === code && p.type === phraseType) || {
                                        word: pr.oldWord,
                                        code,
                                        type: phraseType,
                                        weight: weightMap.get(pr.id) ?? pr.weight ?? 0,
                                        remark: pr.remark || undefined
                                    }
                                    const after = afterList.find(p => p.word === pr.word && p.code === code && p.type === phraseType) || {
                                        word: pr.word,
                                        code,
                                        type: phraseType,
                                        weight: before.weight,
                                        remark: pr.remark || before.remark
                                    }
                                    diffs.push({ type: 'modify', before, after })
                                    modifiedCount++
                                }
                                break
                            case 'Delete':
                                if (pr.word) {
                                    const phrase = beforeList.find(p => p.word === pr.word && p.code === code && p.type === phraseType) || {
                                        word: pr.word,
                                        code,
                                        type: phraseType,
                                        weight: pr.weight ?? 0,
                                        remark: pr.remark || undefined
                                    }
                                    diffs.push({ type: 'remove', phrase })
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
                                beforeArr.push(...sortPhrases(originalState.get(stateKey(phraseType, code)) || []))
                                afterArr.push(...sortPhrases(currentState.get(stateKey(phraseType, code)) || []))
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
