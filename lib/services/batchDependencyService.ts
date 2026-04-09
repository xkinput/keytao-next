import { prisma } from '@/lib/prisma'
import { checkBatchConflictsWithWeight, type BatchPRItem } from './batchConflictService'
import type { PhraseType } from '@/lib/constants/phraseTypes'
type TransactionClient = Omit<
    typeof prisma,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

/**
 * Build PRDependency records from conflict results.
 * Used both at batch creation time and after individual PR edits.
 *
 * @param prs - ordered list of PR records (same order as items passed to checkBatchConflictsWithWeight)
 * @param results - output of checkBatchConflictsWithWeight
 * @param tx - prisma transaction client (or prisma directly)
 */
export async function buildDependencies(
    prs: { id: number }[],
    results: Awaited<ReturnType<typeof checkBatchConflictsWithWeight>>,
    tx: TransactionClient | typeof prisma
) {
    for (let i = 0; i < results.length; i++) {
        const conflict = results[i].conflict
        const resolvedSuggestion = conflict.suggestions?.find(s => s.action === 'Resolved')

        if (!resolvedSuggestion || resolvedSuggestion.resolverIndex === undefined) continue

        const movingPR = prs[resolvedSuggestion.resolverIndex]
        const occupyingPR = prs[i]

        if (!movingPR || !occupyingPR || movingPR.id === occupyingPR.id) continue

        await tx.pullRequestDependency.create({
            data: {
                dependentId: occupyingPR.id,
                dependsOnId: movingPR.id,
                reason: `必须先将 "${resolvedSuggestion.word}" 从编码 "${conflict.code}" 移走`
            }
        })
    }
}

/**
 * Rebuild all dependencies for a batch.
 * Deletes existing ones and recomputes from current PR state.
 */
export async function rebuildBatchDependencies(batchId: string) {
    const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: {
            pullRequests: { orderBy: { createAt: 'asc' } }
        }
    })

    if (!batch) return

    const items: BatchPRItem[] = batch.pullRequests
        .filter(pr => pr.word && pr.code)
        .map(pr => ({
            id: String(pr.id),
            action: pr.action as 'Create' | 'Change' | 'Delete',
            word: pr.word!,
            oldWord: pr.oldWord || undefined,
            code: pr.code!,
            weight: pr.weight || undefined,
            type: (pr.type || 'Phrase') as PhraseType,
        }))

    const results = await checkBatchConflictsWithWeight(items)

    // prs in same order as items (filtered PRs only)
    const filteredPRs = batch.pullRequests.filter(pr => pr.word && pr.code)

    await prisma.$transaction(async (tx) => {
        // Delete all existing dependencies for PRs in this batch
        await tx.pullRequestDependency.deleteMany({
            where: {
                OR: [
                    { dependent: { batchId } },
                    { dependsOn: { batchId } }
                ]
            }
        })

        await buildDependencies(filteredPRs, results, tx)
    })
}
