import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestUser,
  seedPhrases,
  createTestBatch,
} from '@/lib/test/helpers'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'

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

      const changes = batchData!.pullRequests.map((pr) => ({
        action: pr.action,
        word: pr.word || '',
        code: pr.code || '',
        phraseId: pr.phraseId || undefined,
        weight: pr.weight || undefined,
        oldWord: pr.oldWord || undefined,
      }))

      const validation = await conflictDetector.validateBatch(changes)

      expect(validation.valid).toBe(true)
      expect(validation.unresolvedConflicts).toHaveLength(0)

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

      const changes = batchData!.pullRequests.map((pr) => ({
        action: pr.action,
        word: pr.word || '',
        code: pr.code || '',
        phraseId: pr.phraseId || undefined,
        weight: pr.weight || undefined,
        oldWord: pr.oldWord || undefined,
      }))

      const validation = await conflictDetector.validateBatch(changes)

      // The validation should fail because the phrase doesn't exist
      expect(validation.valid).toBe(false)
      expect(validation.conflicts.length).toBeGreaterThan(0)
      expect(validation.unresolvedConflicts.length).toBeGreaterThan(0)
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
  })
})
