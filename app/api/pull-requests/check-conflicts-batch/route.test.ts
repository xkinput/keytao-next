import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestUser,
  seedPhrases,
  checkBatchConflicts,
  ConflictCheckItem,
} from '@/lib/test/helpers'

describe('Batch Conflict Detection', () => {
  let testUserId: number

  beforeEach(async () => {
    const user = await createTestUser()
    testUserId = user.id
  })

  describe('Scenario 1: Add duplicate code phrase', () => {
    it('should allow creating duplicate code but provide suggestions', async () => {
      // Seed: 如果 rjgl (weight: 100)
      const seeded = await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Verify seeded data exists
      expect(seeded).toHaveLength(1)
      expect(seeded[0].word).toBe('如果')

      // Verify we can query it back
      const { prisma } = await import('@/lib/prisma')
      const existing = await prisma.phrase.findFirst({
        where: { code: 'rjgl' }
      })
      expect(existing).toBeDefined()
      expect(existing?.word).toBe('如果')

      // Test: Create 茹果 rjgl
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Create',
          word: '茹果',
          code: 'rjgl',
          type: 'Phrase',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results).toHaveLength(1)
      expect(results[0].conflict.hasConflict).toBe(false) // Allow duplicate code
      expect(results[0].conflict.currentPhrase).toBeDefined()
      expect(results[0].conflict.currentPhrase?.word).toBe('如果')
      expect(results[0].conflict.suggestions.length).toBeGreaterThan(0)

      // Check for alternative code suggestions
      const suggestions = results[0].conflict.suggestions
      const hasAltCode = suggestions.some(
        (s) => s.action === 'Move' || s.action === 'Adjust'
      )
      expect(hasAltCode).toBe(true)
    })
  })

  describe('Scenario 2: Add conflict then delete conflicting phrase', () => {
    it('should resolve conflict when deleting the existing phrase in batch', async () => {
      // Seed: 如果 rjgl
      await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Batch:
      // PR1: Create 茹果 rjgl (duplicate)
      // PR2: Delete 如果 rjgl (resolve conflict)
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Create',
          word: '茹果',
          code: 'rjgl',
          type: 'Phrase',
        },
        {
          id: '2',
          action: 'Delete',
          word: '如果',
          code: 'rjgl',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results).toHaveLength(2)

      // PR1: Conflict resolved by later Delete operation
      expect(results[0].conflict.hasConflict).toBe(false)
      expect(results[0].conflict.currentPhrase?.word).toBe('如果')
      expect(results[0].conflict.impact).toContain('将在批次内第 2 个操作中')
      expect(results[0].conflict.impact).toContain('删除了占用词')
      expect(results[0].conflict.suggestions[0].action).toBe('Resolved')

      // PR2: Delete should succeed
      expect(results[1].conflict.hasConflict).toBe(false)
    })
  })

  describe('Scenario 3: Delete phrase then add to same code', () => {
    it('should allow delete followed by create on same code', async () => {
      // Seed: 如果 rjgl
      await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Batch:
      // PR1: Delete 如果 rjgl
      // PR2: Create 茹果 rjgl
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Delete',
          word: '如果',
          code: 'rjgl',
        },
        {
          id: '2',
          action: 'Create',
          word: '茹果',
          code: 'rjgl',
          type: 'Phrase',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results).toHaveLength(2)

      // PR1: Delete should succeed (phrase exists)
      expect(results[0].conflict.hasConflict).toBe(false)
      expect(results[0].conflict.currentPhrase?.word).toBe('如果')

      // PR2: Create should see duplicate code (since delete hasn't executed yet)
      // But in the API route, the batch logic would resolve this
      expect(results[1].conflict.currentPhrase?.word).toBe('如果')
    })
  })

  describe('Scenario 4: Change phrase then add to same code', () => {
    it('should allow change followed by create', async () => {
      // Seed: 如果 rjgl
      await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Batch:
      // PR1: Change 如果 → 茹果 (same code)
      // PR2: Create 如果 rjgl (add back old word)
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Change',
          word: '茹果',
          oldWord: '如果',
          code: 'rjgl',
          type: 'Phrase',
        },
        {
          id: '2',
          action: 'Create',
          word: '如果',
          code: 'rjgl',
          type: 'Phrase',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results).toHaveLength(2)

      // PR1: Change should succeed (old word exists)
      expect(results[0].conflict.hasConflict).toBe(false)

      // PR2: Create would create duplicate code (重码)
      // Even though the word name is the same, it creates a NEW phrase
      // After Change: code has "茹果" (original phrase changed)
      // After Create: code has "茹果" + "如果" (new phrase) = 重码
      // currentPhrase should reflect batch state (after Change)
      expect(results[1].conflict.currentPhrase?.word).toBe('茹果')
      expect(results[1].conflict.hasConflict).toBe(true)
      expect(results[1].conflict.impact).toContain('重码')
      expect(results[1].conflict.impact).toContain('茹果')
    })
  })

  describe('Scenario 5: Duplicate items in batch', () => {
    it('should detect duplicate additions within batch', async () => {
      // No seed needed

      // Batch: Two identical Create operations
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Create',
          word: '测试',
          code: 'test',
          type: 'Phrase',
        },
        {
          id: '2',
          action: 'Create',
          word: '测试',
          code: 'test',
          type: 'Phrase',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results).toHaveLength(2)

      // First one should be ok
      expect(results[0].conflict.hasConflict).toBe(false)

      // Second one should detect duplicate
      expect(results[1].conflict.hasConflict).toBe(true)
      expect(results[1].conflict.impact).toContain('批次内重复')
    })
  })

  describe('Scenario 6: Change with missing oldWord', () => {
    it('should reject change when oldWord not found', async () => {
      // Seed: 如果 rjgl
      await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Test: Change with wrong oldWord
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Change',
          word: '茹果',
          oldWord: '不存在',
          code: 'rjgl',
          type: 'Phrase',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results).toHaveLength(1)
      expect(results[0].conflict.hasConflict).toBe(true)
      expect(results[0].conflict.impact).toContain('不存在')
    })
  })

  describe('Scenario 7: Delete non-existent phrase', () => {
    it('should reject delete when phrase does not exist', async () => {
      // No seed needed

      // Test: Delete non-existent phrase
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Delete',
          word: '不存在',
          code: 'xxxx',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results).toHaveLength(1)
      expect(results[0].conflict.hasConflict).toBe(true)
      expect(results[0].conflict.impact).toContain('不存在')
    })
  })

  describe('Scenario 8: Change without oldWord', () => {
    it('should detect missing oldWord for change action', async () => {
      // Test: Change without oldWord
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Change',
          word: '新词',
          code: 'abc',
          type: 'Phrase',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results).toHaveLength(1)
      expect(results[0].conflict.hasConflict).toBe(true)
      expect(results[0].conflict.impact).toContain('需要指定旧词')
    })
  })

  describe('Additional: Alternative code generation', () => {
    it('should suggest alternative codes like rjgla, rjgll', async () => {
      // Seed: 如果 rjgl
      await seedPhrases(testUserId, [
        { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
      ])

      // Test: Create duplicate
      const items: ConflictCheckItem[] = [
        {
          id: '1',
          action: 'Create',
          word: '茹果',
          code: 'rjgl',
          type: 'Phrase',
        },
      ]

      const { results } = await checkBatchConflicts(items)

      expect(results[0].conflict.suggestions.length).toBeGreaterThan(0)

      const altCodeSuggestions = results[0].conflict.suggestions.filter(
        (s) => s.toCode && s.toCode.startsWith('rjgl')
      )

      // Should suggest codes like rjgla, rjgli, etc.
      expect(altCodeSuggestions.length).toBeGreaterThan(0)
    })
  })

  describe('Advanced Scenarios: Complex batch operations and weight calculation', () => {
    describe('Scenario 9: Delete → Create (position freed)', () => {
      it('should handle position freed by deletion in batch', async () => {
        await seedPhrases(testUserId, [
          { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
        ])

        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Delete', word: '如果', code: 'rjgl' },
          { id: '2', action: 'Create', word: '茹果', code: 'rjgl', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(2)
        expect(results[0].conflict.hasConflict).toBe(false) // Delete succeeds
        // Create sees DB word but conflict is resolved by Delete
        expect(results[1].conflict.currentPhrase?.word).toBe('如果')
        expect(results[1].conflict.impact).toContain('已批次内第 1 个操作中')
        expect(results[1].conflict.impact).toContain('删除了占用词')
      })
    })

    describe('Scenario 10: Create → Delete cycle', () => {
      it('should detect delete of non-existent word created in batch', async () => {
        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Create', word: '新词', code: 'xinc', type: 'Phrase' },
          { id: '2', action: 'Delete', word: '新词', code: 'xinc' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(2)
        expect(results[0].conflict.hasConflict).toBe(false) // Create valid
        // Delete fails - word doesn't exist in DB yet
        expect(results[1].conflict.hasConflict).toBe(true)
        expect(results[1].conflict.impact).toContain('不存在')
      })
    })

    describe('Scenario 11: Multiple Creates - weight progression', () => {
      it('should calculate progressive weights for multiple creates', async () => {
        await seedPhrases(testUserId, [
          { word: '测试1', code: 'test', type: 'Phrase', weight: 100 },
        ])

        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Create', word: '测试2', code: 'test', type: 'Phrase' },
          { id: '2', action: 'Create', word: '测试3', code: 'test', type: 'Phrase' },
          { id: '3', action: 'Create', word: '测试4', code: 'test', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(3)

        // All should be allowed (duplicate code is OK)
        results.forEach(r => expect(r.conflict.hasConflict).toBe(false))

        // Check weight mentions in impact messages
        // PR1: should mention weight 101 (base 100 + 1 existing)
        expect(results[0].conflict.impact).toContain('101')
        // PR2: should mention weight 102 (base 100 + 1 existing + 1 from PR1)
        expect(results[1].conflict.impact).toContain('102')
        // PR3: should mention weight 103 (base 100 + 1 existing + 2 from PR1&2)
        expect(results[2].conflict.impact).toContain('103')
      })
    })

    describe('Scenario 12: Delete all → Create (weight resets to base)', () => {
      it('should calculate base weight when all words deleted in batch', async () => {
        await seedPhrases(testUserId, [
          { word: '测试A', code: 'ceshi', type: 'Phrase', weight: 100 },
          { word: '测试B', code: 'ceshi', type: 'Phrase', weight: 101 },
        ])

        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Delete', word: '测试A', code: 'ceshi' },
          { id: '2', action: 'Delete', word: '测试B', code: 'ceshi' },
          { id: '3', action: 'Create', word: '测试C', code: 'ceshi', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(3)

        // Deletes should succeed
        expect(results[0].conflict.hasConflict).toBe(false)
        expect(results[1].conflict.hasConflict).toBe(false)

        // Create should see existing words but with adjusted weight
        // Weight should be 100 (base) since 2 existing - 2 deleted = 0
        expect(results[2].conflict.impact).toContain('100')
      })
    })

    describe('Scenario 13: Change A→B, then Create A (name reuse)', () => {
      it('should create duplicate code (重码) when creating with old word name after change', async () => {
        await seedPhrases(testUserId, [
          { word: '原词', code: 'code1', type: 'Phrase', weight: 100 },
        ])

        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Change', word: '新词', oldWord: '原词', code: 'code1', type: 'Phrase' },
          { id: '2', action: 'Create', word: '原词', code: 'code1', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(2)

        // Change should succeed
        expect(results[0].conflict.hasConflict).toBe(false)

        // Create will conflict with the changed word
        // After Change executes: code1 has "新词" (changed from 原词)
        // After Create executes: code1 has "新词" + "原词" (new phrase) = 重码
        // currentPhrase should reflect batch state (after Change), not DB state
        expect(results[1].conflict.currentPhrase?.word).toBe('新词')
        expect(results[1].conflict.hasConflict).toBe(true)
        expect(results[1].conflict.impact).toContain('重码')
        expect(results[1].conflict.impact).toContain('新词')
      })
    })

    describe('Scenario 14: Complex chain - Delete, Change, Create', () => {
      it('should handle multiple operations on same code', async () => {
        await seedPhrases(testUserId, [
          { word: '词一', code: 'chain', type: 'Phrase', weight: 100 },
          { word: '词二', code: 'chain', type: 'Phrase', weight: 101 },
          { word: '词三', code: 'chain', type: 'Phrase', weight: 102 },
        ])

        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Delete', word: '词一', code: 'chain' },
          { id: '2', action: 'Change', word: '词二改', oldWord: '词二', code: 'chain', type: 'Phrase' },
          { id: '3', action: 'Create', word: '词四', code: 'chain', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(3)

        // All operations should be valid
        expect(results[0].conflict.hasConflict).toBe(false) // Delete exists
        expect(results[1].conflict.hasConflict).toBe(false) // Change exists
        expect(results[2].conflict.hasConflict).toBe(false) // Create allowed

        // Create should see existing words
        expect(results[2].conflict.currentPhrase).toBeDefined()

        // Weight calculation: After Delete 词一, remaining weights are {101, 102}
        // Change doesn't affect weight, so still {101, 102}
        // New word appends to end: max(101,102) + 1 = 103
        expect(results[2].conflict.impact).toContain('103')
      })
    })

    describe('Scenario 15: Batch duplicate detection', () => {
      it('should detect exact duplicates within batch', async () => {
        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Create', word: '重复词', code: 'cfuc', type: 'Phrase' },
          { id: '2', action: 'Create', word: '重复词', code: 'cfuc', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(2)

        // First Create is valid
        expect(results[0].conflict.hasConflict).toBe(false)

        // Second Create should be flagged as duplicate
        expect(results[1].conflict.hasConflict).toBe(true)
        expect(results[1].conflict.impact).toContain('批次内重复')
      })
    })

    describe('Scenario 16: Delete reduces weight for subsequent Create', () => {
      it('should reflect deletion in weight calculation', async () => {
        await seedPhrases(testUserId, [
          { word: '词A', code: 'worda', type: 'Phrase', weight: 100 },
          { word: '词B', code: 'worda', type: 'Phrase', weight: 101 },
          { word: '词C', code: 'worda', type: 'Phrase', weight: 102 },
        ])

        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Delete', word: '词A', code: 'worda' },
          { id: '2', action: 'Create', word: '词D', code: 'worda', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(2)

        // Weight calculation: After Delete 词A, remaining weights are {101, 102}
        // New word appends to end: max(101,102) + 1 = 103
        expect(results[1].conflict.impact).toContain('103')
      })
    })

    describe('Scenario 17: Multiple Deletes reduce weight progressively', () => {
      it('should accumulate deletion effects on weight', async () => {
        await seedPhrases(testUserId, [
          { word: '词1', code: 'multi', type: 'Phrase', weight: 100 },
          { word: '词2', code: 'multi', type: 'Phrase', weight: 101 },
          { word: '词3', code: 'multi', type: 'Phrase', weight: 102 },
          { word: '词4', code: 'multi', type: 'Phrase', weight: 103 },
        ])

        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Delete', word: '词1', code: 'multi' },
          { id: '2', action: 'Delete', word: '词2', code: 'multi' },
          { id: '3', action: 'Delete', word: '词3', code: 'multi' },
          { id: '4', action: 'Create', word: '词5', code: 'multi', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(4)

        // Weight calculation: After Delete 词1,词2,词3, remaining weight is {103}
        // New word appends to end: max(103) + 1 = 104
        expect(results[3].conflict.impact).toContain('104')
      })
    })

    describe('Scenario 18: Exact word+code combination duplicate', () => {
      it('should reject creating exact same word+code combination', async () => {
        // Seed: 这里 felk
        await seedPhrases(testUserId, [
          { word: '这里', code: 'felk', type: 'Phrase', weight: 100 },
        ])

        // Test: Try to create the exact same combination
        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Create', word: '这里', code: 'felk', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(1)

        // Should have conflict because word+code combination already exists
        expect(results[0].conflict.hasConflict).toBe(true)
        expect(results[0].conflict.currentPhrase).toBeDefined()
        expect(results[0].conflict.currentPhrase?.word).toBe('这里')
        expect(results[0].conflict.impact).toContain('组合已存在')
        expect(results[0].conflict.suggestions[0].action).toBe('Cancel')
      })

      it('should allow creating different word with same code (重码)', async () => {
        // Seed: 这里 felk
        await seedPhrases(testUserId, [
          { word: '这里', code: 'felk', type: 'Phrase', weight: 100 },
        ])

        // Test: Create different word with same code (allowed 重码)
        const items: ConflictCheckItem[] = [
          { id: '1', action: 'Create', word: '那里', code: 'felk', type: 'Phrase' },
        ]

        const { results } = await checkBatchConflicts(items)

        expect(results).toHaveLength(1)

        // Should NOT have conflict - 重码 is allowed
        expect(results[0].conflict.hasConflict).toBe(false)
        expect(results[0].conflict.currentPhrase?.word).toBe('这里')
        expect(results[0].conflict.suggestions.length).toBeGreaterThan(0)
        expect(results[0].calculatedWeight).toBe(101) // base 100 + 1 existing
      })
    })
  })
})
