import { describe, it, expect, beforeEach } from 'vitest'
import { createTestUser, seedPhrases, checkBatchConflicts } from '@/lib/test/helpers'
import type { ConflictCheckItem } from '@/lib/test/helpers'

describe('Performance & Scalability Tests', () => {
  let userId: number

  beforeEach(async () => {
    const user = await createTestUser()
    userId = user.id
  })

  describe('Large Batch Operations', () => {
    it('should handle 100+ Create operations efficiently', async () => {
      // Seed a base phrase
      await seedPhrases(userId, [
        { word: 'base', code: 'test', type: 'Phrase', weight: 100 }
      ])

      // Generate 100 Create operations
      const items: ConflictCheckItem[] = Array.from({ length: 100 }, (_, i) => ({
        id: `${i + 1}`,
        action: 'Create' as const,
        word: `word${i + 1}`,
        code: 'test',
        type: 'Phrase' as const,
      }))

      const startTime = performance.now()
      const { results } = await checkBatchConflicts(items)
      const duration = performance.now() - startTime

      // Assertions
      expect(results).toHaveLength(100)
      expect(duration).toBeLessThan(5000) // Should complete in less than 5 seconds

      // Verify weight progression
      expect(results[0].calculatedWeight).toBe(101) // base(100) + 1 existing
      expect(results[49].calculatedWeight).toBe(150) // base(100) + 1 existing + 49 previous
      expect(results[99].calculatedWeight).toBe(200) // base(100) + 1 existing + 99 previous

      // All should succeed
      results.forEach(r => {
        expect(r.conflict.hasConflict).toBe(false)
      })

      console.log(`✓ 100 Create operations processed in ${duration.toFixed(2)}ms`)
    })

    it('should handle 100+ mixed operations (Delete/Change/Create)', async () => {
      // Seed 50 phrases
      const baseWords = Array.from({ length: 50 }, (_, i) => ({
        word: `existing${i}`,
        code: 'mixed',
        type: 'Phrase' as const,
        weight: 100 + i,
      }))
      await seedPhrases(userId, baseWords)

      // Generate mixed operations: 30 Deletes + 30 Changes + 40 Creates
      const items: ConflictCheckItem[] = [
        // 30 Deletes
        ...Array.from({ length: 30 }, (_, i) => ({
          id: `d${i + 1}`,
          action: 'Delete' as const,
          word: `existing${i}`,
          code: 'mixed',
        })),
        // 30 Changes
        ...Array.from({ length: 30 }, (_, i) => ({
          id: `c${i + 1}`,
          action: 'Change' as const,
          word: `changed${i}`,
          oldWord: `existing${i + 30}`,
          code: 'mixed',
          type: 'Phrase' as const,
        })),
        // 40 Creates
        ...Array.from({ length: 40 }, (_, i) => ({
          id: `cr${i + 1}`,
          action: 'Create' as const,
          word: `new${i}`,
          code: 'mixed',
          type: 'Phrase' as const,
        })),
      ]

      const startTime = performance.now()
      const { results } = await checkBatchConflicts(items)
      const duration = performance.now() - startTime

      expect(results).toHaveLength(100)
      expect(duration).toBeLessThan(10000) // Should complete in less than 10 seconds

      console.log(`✓ 100 mixed operations processed in ${duration.toFixed(2)}ms`)
    })

    it('should handle 200+ operations with conflict resolution', async () => {
      // Seed base phrases
      await seedPhrases(userId, Array.from({ length: 100 }, (_, i) => ({
        word: `word${i}`,
        code: 'conflict',
        type: 'Phrase' as const,
        weight: 100 + i,
      })))

      // Generate operations: Delete all 100 + Create 100 new
      const items: ConflictCheckItem[] = [
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `d${i + 1}`,
          action: 'Delete' as const,
          word: `word${i}`,
          code: 'conflict',
        })),
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `c${i + 1}`,
          action: 'Create' as const,
          word: `new${i}`,
          code: 'conflict',
          type: 'Phrase' as const,
        })),
      ]

      const startTime = performance.now()
      const { results } = await checkBatchConflicts(items)
      const duration = performance.now() - startTime

      expect(results).toHaveLength(200)
      expect(duration).toBeLessThan(15000) // Should complete in less than 15 seconds

      // Verify deletes succeeded
      results.slice(0, 100).forEach(r => {
        expect(r.conflict.hasConflict).toBe(false)
      })

      // Verify creates see conflicts but are resolved by deletes
      const createResults = results.slice(100, 200)
      createResults.forEach(r => {
        // Should have currentPhrase (saw DB conflict)
        expect(r.conflict.currentPhrase).toBeDefined()
        // But conflict is resolved by earlier Delete
        expect(r.conflict.hasConflict).toBe(false)
        expect(r.conflict.impact).toContain('已批次内第')
        expect(r.conflict.impact).toContain('删除了占用词')
      })

      console.log(`✓ 200 operations with conflict resolution processed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('Performance Benchmarks', () => {
    it('should demonstrate O(n) performance with Map optimization', async () => {
      const sizes = [10, 50, 100, 200]
      const timings: { size: number; duration: number; opsPerMs: number }[] = []

      for (const size of sizes) {
        // Seed base phrases
        await seedPhrases(userId, [
          { word: 'base', code: `bench${size}`, type: 'Phrase', weight: 100 }
        ])

        // Generate Create operations
        const items: ConflictCheckItem[] = Array.from({ length: size }, (_, i) => ({
          id: `${i + 1}`,
          action: 'Create' as const,
          word: `w${i}`,
          code: `bench${size}`,
          type: 'Phrase' as const,
        }))

        const startTime = performance.now()
        await checkBatchConflicts(items)
        const duration = performance.now() - startTime

        timings.push({
          size,
          duration,
          opsPerMs: size / duration,
        })
      }

      console.log('\n📊 Performance Benchmarks:')
      timings.forEach(t => {
        console.log(`  Size ${t.size.toString().padStart(3)}: ${t.duration.toFixed(2)}ms (${t.opsPerMs.toFixed(2)} ops/ms)`)
      })

      // Verify roughly linear scaling (allows for variance)
      // O(n) means duration should scale roughly linearly with size
      const ratio100to10 = timings[2].duration / timings[0].duration
      const ratio200to100 = timings[3].duration / timings[2].duration

      // Both ratios should be roughly similar for O(n) complexity
      // Allow 3x variance for database I/O and other factors
      expect(Math.abs(ratio200to100 / ratio100to10)).toBeLessThan(3)
    })

    it('should efficiently handle duplicate detection in large batches', async () => {
      // Create batch with many duplicates
      const items: ConflictCheckItem[] = []
      for (let i = 0; i < 50; i++) {
        items.push({
          id: `${i * 2 + 1}`,
          action: 'Create' as const,
          word: `word${i}`,
          code: 'dup',
          type: 'Phrase' as const,
        })
        items.push({
          id: `${i * 2 + 2}`,
          action: 'Create' as const,
          word: `word${i}`, // Duplicate
          code: 'dup',
          type: 'Phrase' as const,
        })
      }

      const startTime = performance.now()
      const { results } = await checkBatchConflicts(items)
      const duration = performance.now() - startTime

      expect(results).toHaveLength(100)
      expect(duration).toBeLessThan(3000) // Fast duplicate detection

      // Every second item should be flagged as duplicate
      for (let i = 0; i < 50; i++) {
        expect(results[i * 2].conflict.hasConflict).toBe(false) // First of pair
        expect(results[i * 2 + 1].conflict.hasConflict).toBe(true) // Duplicate
        expect(results[i * 2 + 1].conflict.impact).toContain('批次内重复')
      }

      console.log(`✓ 100 items with 50 duplicates processed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('Stress Tests', () => {
    it('should handle extreme batch size (500 operations)', async () => {
      await seedPhrases(userId, [
        { word: 'stress', code: 'stress', type: 'Phrase', weight: 100 }
      ])

      const items: ConflictCheckItem[] = Array.from({ length: 500 }, (_, i) => ({
        id: `${i + 1}`,
        action: 'Create' as const,
        word: `stress${i}`,
        code: 'stress',
        type: 'Phrase' as const,
      }))

      const startTime = performance.now()
      const { results } = await checkBatchConflicts(items)
      const duration = performance.now() - startTime

      expect(results).toHaveLength(500)
      expect(duration).toBeLessThan(30000) // Should complete in less than 30 seconds

      // Verify correctness with large dataset
      expect(results[0].calculatedWeight).toBe(101)
      expect(results[499].calculatedWeight).toBe(600) // base + 1 existing + 499 previous

      console.log(`✓ 500 operations processed in ${duration.toFixed(2)}ms`)
    }, 35000) // Increase timeout for this test
  })

  describe('Concurrent Operations Simulation', () => {
    it('should handle multiple independent code batches', async () => {
      // Simulate concurrent batches on different codes
      const codes = ['code1', 'code2', 'code3', 'code4', 'code5']

      // Seed base data for all codes
      await seedPhrases(userId, codes.map(code => ({
        word: 'base',
        code,
        type: 'Phrase' as const,
        weight: 100,
      })))

      // Create interleaved operations on different codes
      const items: ConflictCheckItem[] = []
      for (let i = 0; i < 20; i++) {
        codes.forEach((code, codeIdx) => {
          items.push({
            id: `${i * codes.length + codeIdx + 1}`,
            action: 'Create' as const,
            word: `w${i}_${code}`,
            code,
            type: 'Phrase' as const,
          })
        })
      }

      const startTime = performance.now()
      const { results } = await checkBatchConflicts(items)
      const duration = performance.now() - startTime

      expect(results).toHaveLength(100) // 20 iterations * 5 codes
      expect(duration).toBeLessThan(5000)

      // Verify operations on different codes don't interfere
      codes.forEach((code, codeIdx) => {
        const codeResults = results.filter((_, idx) => idx % codes.length === codeIdx)
        expect(codeResults).toHaveLength(20)

        // First operation on this code
        expect(codeResults[0].calculatedWeight).toBe(101)
        // Last operation on this code
        expect(codeResults[19].calculatedWeight).toBe(120)
      })

      console.log(`✓ 100 concurrent operations on 5 codes processed in ${duration.toFixed(2)}ms`)
    })
  })
})
