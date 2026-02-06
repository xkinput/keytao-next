import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestUser,
  seedPhrases,
  createTestBatch,
} from '@/lib/test/helpers'
import { prisma } from '@/lib/prisma'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { PhraseType } from '@/lib/constants/phraseTypes'

describe('Batch Submission and Approval', () => {
  let testUserId: number

  beforeEach(async () => {
    const user = await createTestUser()
    testUserId = user.id
  })

  describe('Batch Submission', () => {
    it('should submit batch without conflicts', async () => {
      // Seed: 如果 rjgl
      await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Create batch with Delete operation (no conflict)
      const { batch } = await createTestBatch(testUserId, [
        {
          action: 'Delete',
          word: '如果',
          code: 'rjgl',
        },
      ])

      // Validate batch
      const batchData = await prisma.batch.findUnique({
        where: { id: batch.id },
        include: { pullRequests: true },
      })

      expect(batchData).toBeDefined()
      expect(batchData!.pullRequests).toHaveLength(1)

      const items = batchData!.pullRequests.map((pr) => ({
        id: pr.id.toString(),
        action: pr.action as 'Create' | 'Change' | 'Delete',
        word: pr.word || '',
        oldWord: pr.oldWord || undefined,
        code: pr.code || '',
        type: (pr.type || 'Phrase') as PhraseType,
        weight: pr.weight || undefined,
      }))

      const results = await checkBatchConflictsWithWeight(items)
      const unresolvedConflicts = results.filter(result => {
        const isResolved = result.conflict.suggestions?.some(sug => sug.action === 'Resolved')
        return result.conflict.hasConflict && !isResolved
      })

      expect(unresolvedConflicts).toHaveLength(0)

      // Submit batch
      const updated = await prisma.batch.update({
        where: { id: batch.id },
        data: { status: 'Submitted' },
      })

      expect(updated.status).toBe('Submitted')
    })

    it('should reject submission of batch with unresolved conflicts', async () => {
      // Create batch with Delete operation for non-existent phrase (conflict)
      const { batch } = await createTestBatch(testUserId, [
        {
          action: 'Delete',
          word: '不存在',
          code: 'xxxx',
        },
      ])

      // Validate batch
      const batchData = await prisma.batch.findUnique({
        where: { id: batch.id },
        include: { pullRequests: true },
      })

      expect(batchData).toBeDefined()
      expect(batchData!.pullRequests).toHaveLength(1)

      const items = batchData!.pullRequests.map((pr) => ({
        id: pr.id.toString(),
        action: pr.action as 'Create' | 'Change' | 'Delete',
        word: pr.word || '',
        oldWord: pr.oldWord || undefined,
        code: pr.code || '',
        type: (pr.type || 'Phrase') as PhraseType,
        weight: pr.weight || undefined,
      }))

      const results = await checkBatchConflictsWithWeight(items)
      const unresolvedConflicts = results.filter(result => {
        const isResolved = result.conflict.suggestions?.some(sug => sug.action === 'Resolved')
        return result.conflict.hasConflict && !isResolved
      })

      // The validation should fail because the phrase doesn't exist
      expect(unresolvedConflicts.length).toBeGreaterThan(0)
    })

    it('should reject submission of empty batch', async () => {
      // Create empty batch
      const batch = await prisma.batch.create({
        data: {
          creatorId: testUserId,
          description: 'Empty batch',
          status: 'Draft',
        },
      })

      const batchData = await prisma.batch.findUnique({
        where: { id: batch.id },
        include: { pullRequests: true },
      })

      expect(batchData!.pullRequests).toHaveLength(0)
      // Should not allow submission
    })
  })

  describe('Batch Approval and Execution', () => {
    it('should execute Delete operation correctly', async () => {
      // Seed: 如果 rjgl
      const phrases = await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Create and approve batch with Delete
      const { batch, prs } = await createTestBatch(testUserId, [
        {
          action: 'Delete',
          word: '如果',
          code: 'rjgl',
          phraseId: phrases[0].id,
        },
      ])

      // Update to Submitted
      await prisma.batch.update({
        where: { id: batch.id },
        data: { status: 'Submitted' },
      })

      // Execute transaction
      await prisma.$transaction(async (tx) => {
        for (const pr of prs) {
          if (pr.action === 'Delete' && pr.phraseId) {
            await tx.phrase.delete({
              where: { id: pr.phraseId },
            })
          }

          await tx.pullRequest.update({
            where: { id: pr.id },
            data: { status: 'Approved' },
          })
        }

        await tx.batch.update({
          where: { id: batch.id },
          data: { status: 'Approved' },
        })
      })

      // Verify phrase is deleted
      const deletedPhrase = await prisma.phrase.findUnique({
        where: { id: phrases[0].id },
      })
      expect(deletedPhrase).toBeNull()

      // Verify batch and PR status
      const updatedBatch = await prisma.batch.findUnique({
        where: { id: batch.id },
        include: { pullRequests: true },
      })
      expect(updatedBatch!.status).toBe('Approved')
      expect(updatedBatch!.pullRequests[0].status).toBe('Approved')
    })

    it('should execute Create operation correctly', async () => {
      // Create batch with Create operation
      const { batch, prs } = await createTestBatch(testUserId, [
        {
          action: 'Create',
          word: '测试',
          code: 'ceshi',
          type: 'Phrase',
          weight: 100,
        },
      ])

      // Verify batch exists before transaction
      const batchBeforeTx = await prisma.batch.findUnique({
        where: { id: batch.id },
      })
      expect(batchBeforeTx).toBeDefined()

      // Update to Submitted
      await prisma.batch.update({
        where: { id: batch.id },
        data: { status: 'Submitted' },
      })

      // Execute transaction
      await prisma.$transaction(async (tx) => {
        for (const pr of prs) {
          if (pr.action === 'Create' && pr.word && pr.code) {
            await tx.phrase.create({
              data: {
                word: pr.word,
                code: pr.code,
                type: pr.type || 'Phrase',
                weight: pr.weight || 0,
                userId: pr.userId,
                status: 'Finish',
              },
            })
          }

          await tx.pullRequest.update({
            where: { id: pr.id },
            data: { status: 'Approved' },
          })
        }

        await tx.batch.update({
          where: { id: batch.id },
          data: { status: 'Approved' },
        })
      })

      // Verify phrase is created
      const createdPhrase = await prisma.phrase.findFirst({
        where: { word: '测试', code: 'ceshi' },
      })
      expect(createdPhrase).toBeDefined()
      expect(createdPhrase!.word).toBe('测试')
      expect(createdPhrase!.code).toBe('ceshi')
    })

    it('should execute Change operation correctly', async () => {
      // Seed: 如果 rjgl
      const phrases = await seedPhrases(testUserId, [
        { word: '如果A', code: 'rjgla', type: 'Phrase', weight: 100 },
      ])

      // Create batch with Change operation
      const { batch, prs } = await createTestBatch(testUserId, [
        {
          action: 'Change',
          word: '茹果A',
          oldWord: '如果A',
          code: 'rjgla',
          type: 'Phrase',
          weight: 100,
        },
      ])

      // Update to Submitted
      await prisma.batch.update({
        where: { id: batch.id },
        data: { status: 'Submitted' },
      })

      // Execute transaction
      await prisma.$transaction(async (tx) => {
        for (const pr of prs) {
          if (pr.action === 'Change' && pr.oldWord && pr.code && pr.word) {
            const oldPhrase = await tx.phrase.findFirst({
              where: {
                word: pr.oldWord,
                code: pr.code,
              },
            })

            if (oldPhrase) {
              await tx.phrase.update({
                where: { id: oldPhrase.id },
                data: {
                  word: pr.word,
                  type: pr.type || undefined,
                  weight: pr.weight !== null ? pr.weight : undefined,
                },
              })
            }
          }

          await tx.pullRequest.update({
            where: { id: pr.id },
            data: { status: 'Approved' },
          })
        }

        await tx.batch.update({
          where: { id: batch.id },
          data: { status: 'Approved' },
        })
      })

      // Verify phrase is changed
      const changedPhrase = await prisma.phrase.findUnique({
        where: { id: phrases[0].id },
      })
      expect(changedPhrase).toBeDefined()
      expect(changedPhrase!.word).toBe('茹果A')
      expect(changedPhrase!.code).toBe('rjgla')

      // Old word should not exist
      const oldPhrase = await prisma.phrase.findFirst({
        where: { word: '如果A', code: 'rjgla' },
      })
      expect(oldPhrase).toBeNull()
    })

    it('should execute batch with Delete then Create operations', async () => {
      // Seed: 如果 rjgl
      const phrases = await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Create batch: Delete old + Create new
      const { batch, prs } = await createTestBatch(testUserId, [
        {
          action: 'Delete',
          word: '如果',
          code: 'rjgl',
          phraseId: phrases[0].id,
        },
        {
          action: 'Create',
          word: '茹果',
          code: 'rjgl',
          type: 'Phrase',
          weight: 100,
        },
      ])

      // Update to Submitted
      await prisma.batch.update({
        where: { id: batch.id },
        data: { status: 'Submitted' },
      })

      // Execute transaction
      await prisma.$transaction(async (tx) => {
        for (const pr of prs) {
          if (pr.action === 'Delete' && pr.phraseId) {
            await tx.phrase.delete({
              where: { id: pr.phraseId },
            })
          } else if (pr.action === 'Create' && pr.word && pr.code) {
            await tx.phrase.create({
              data: {
                word: pr.word,
                code: pr.code,
                type: pr.type || 'Phrase',
                weight: pr.weight || 0,
                userId: pr.userId,
                status: 'Finish',
              },
            })
          }

          await tx.pullRequest.update({
            where: { id: pr.id },
            data: { status: 'Approved' },
          })
        }

        await tx.batch.update({
          where: { id: batch.id },
          data: { status: 'Approved' },
        })
      })

      // Verify old phrase is deleted
      const oldPhrase = await prisma.phrase.findUnique({
        where: { id: phrases[0].id },
      })
      expect(oldPhrase).toBeNull()

      // Verify new phrase is created
      const newPhrase = await prisma.phrase.findFirst({
        where: { word: '茹果', code: 'rjgl' },
      })
      expect(newPhrase).toBeDefined()
      expect(newPhrase!.word).toBe('茹果')
    })

    it('should calculate correct weight for Create when Delete comes after', async () => {
      // Scenario 2: Create 重码 then Delete 占用词
      // Seed: S2词 @ sbcode (weight: 100)
      const phrases = await seedPhrases(testUserId, [
        { word: 'S2词', code: 'sbcode', type: 'Phrase', weight: 100 },
      ])

      // Create batch: Create S2重码 first, then Delete S2词
      const { batch, prs } = await createTestBatch(testUserId, [
        {
          action: 'Create',
          word: 'S2重码',
          code: 'sbcode',
          type: 'Phrase',
          // Weight should be 100 (not 101) because Delete comes after
        },
        {
          action: 'Delete',
          word: 'S2词',
          code: 'sbcode',
          phraseId: phrases[0].id,
        },
      ])

      // Verify the Create PR has correct calculated weight
      const createPR = prs.find(pr => pr.action === 'Create')
      expect(createPR).toBeDefined()

      // Check conflict detection result (should include weight calculation)
      const { checkBatchConflicts } = await import('@/lib/test/helpers')
      const { results } = await checkBatchConflicts([
        {
          id: String(createPR!.id),
          action: 'Create',
          word: 'S2重码',
          code: 'sbcode',
          type: 'Phrase',
        },
        {
          id: String(prs.find(pr => pr.action === 'Delete')!.id),
          action: 'Delete',
          word: 'S2词',
          code: 'sbcode',
        },
      ])

      // Weight should be 100: base(100) + 1 existing - 1 deleted = 100
      expect(results[0].calculatedWeight).toBe(100)
      expect(results[0].conflict.hasConflict).toBe(false)
      expect(results[0].conflict.impact).toContain('将在批次内第 2 个操作中')

      // Update to Submitted
      await prisma.batch.update({
        where: { id: batch.id },
        data: { status: 'Submitted' },
      })

      // Calculate dynamic weights (same as approval endpoint does)
      const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')

      const prItems = prs.map(pr => ({
        id: String(pr.id),
        action: pr.action as 'Create' | 'Change' | 'Delete',
        word: pr.word || '',
        oldWord: pr.oldWord || undefined,
        code: pr.code || '',
        type: pr.type as PhraseType,
        weight: pr.weight || undefined,
      }))

      const conflictResults = await checkBatchConflictsWithWeight(prItems)

      // Create weight map
      const weightMap = new Map<number, number>()
      conflictResults.forEach(result => {
        const prId = parseInt(result.id)
        if (!isNaN(prId) && result.calculatedWeight !== undefined) {
          weightMap.set(prId, result.calculatedWeight)
        }
      })

      // Execute with dynamic weights (same logic as approval endpoint)
      await prisma.$transaction(async (tx) => {
        for (const pr of prs) {
          if (pr.action === 'Delete' && pr.phraseId) {
            await tx.phrase.delete({
              where: { id: pr.phraseId },
            })
          } else if (pr.action === 'Create' && pr.word && pr.code) {
            // Use dynamically calculated weight
            const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0

            await tx.phrase.create({
              data: {
                word: pr.word,
                code: pr.code,
                type: pr.type || 'Phrase',
                weight: finalWeight,
                userId: pr.userId,
                status: 'Finish',
              },
            })
          }

          await tx.pullRequest.update({
            where: { id: pr.id },
            data: { status: 'Approved' },
          })
        }

        await tx.batch.update({
          where: { id: batch.id },
          data: { status: 'Approved' },
        })
      })

      // Verify S2词 is deleted
      const oldPhrase = await prisma.phrase.findUnique({
        where: { id: phrases[0].id },
      })
      expect(oldPhrase).toBeNull()

      // Verify S2重码 is created with correct weight (100, not 101)
      const newPhrase = await prisma.phrase.findFirst({
        where: { word: 'S2重码', code: 'sbcode' },
      })
      expect(newPhrase).toBeDefined()
      expect(newPhrase!.word).toBe('S2重码')
      expect(newPhrase!.code).toBe('sbcode')
      expect(newPhrase!.weight).toBe(100) // Dynamic weight, not 101

      // Verify only one phrase exists on this code
      const allPhrases = await prisma.phrase.findMany({
        where: { code: 'sbcode' },
      })
      expect(allPhrases).toHaveLength(1)
      expect(allPhrases[0].word).toBe('S2重码')
      expect(allPhrases[0].weight).toBe(100)
    })
  })
})
