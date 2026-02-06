import { prisma } from '@/lib/prisma'
import { PhraseType, UserStatus, SignUpType } from '@prisma/client'
import bcrypt from 'bcrypt'
import { ConflictInfo } from '@/lib/services/conflictDetector'

export interface TestPhraseData {
  word: string
  code: string
  type?: PhraseType
  weight?: number
  remark?: string
}

export interface ConflictCheckItem {
  id: string
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord?: string
  code: string
  weight?: number
  type?: PhraseType
}

/**
 * Seed phrases into test database
 */
export async function seedPhrases(
  userId: number,
  phrases: TestPhraseData[]
) {
  const created = []
  for (const phrase of phrases) {
    const result = await prisma.phrase.create({
      data: {
        word: phrase.word,
        code: phrase.code,
        type: phrase.type || 'Phrase',
        weight: phrase.weight || 100,
        remark: phrase.remark,
        userId,
      },
    })
    created.push(result)
  }
  return created
}

/**
 * Create a test user
 */
export async function createTestUser(options?: {
  name?: string
  email?: string
  password?: string
}) {
  const hashedPassword = await bcrypt.hash(options?.password || 'password123', 10)
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)

  return prisma.user.create({
    data: {
      name: options?.name || `testuser_${timestamp}_${random}`,
      email: options?.email || `test_${timestamp}_${random}@example.com`,
      password: hashedPassword,
      status: UserStatus.ENABLE,
      signUpType: SignUpType.USERNAME,
    },
  })
}

/**
 * Create a test batch with pull requests
 */
export async function createTestBatch(
  userId: number,
  prs: Array<{
    action: 'Create' | 'Change' | 'Delete'
    word?: string
    oldWord?: string
    code?: string
    type?: PhraseType
    weight?: number
    phraseId?: number
  }>
) {
  const batch = await prisma.batch.create({
    data: {
      creatorId: userId,
      description: 'Test batch',
      status: 'Draft',
    },
  })

  const createdPrs = []
  for (const pr of prs) {
    const created = await prisma.pullRequest.create({
      data: {
        action: pr.action,
        word: pr.word,
        oldWord: pr.oldWord,
        code: pr.code,
        type: pr.type,
        weight: pr.weight,
        phraseId: pr.phraseId,
        userId,
        batchId: batch.id,
      },
    })
    createdPrs.push(created)
  }

  return { batch, prs: createdPrs }
}

/**
 * Call batch conflict check API
 */
export async function checkBatchConflicts(items: ConflictCheckItem[]): Promise<{
  results: Array<{
    id: string
    conflict: ConflictInfo
    calculatedWeight?: number
  }>
}> {
  // Use the new unified batch conflict service
  const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')

  const results = await checkBatchConflictsWithWeight(items)

  return { results }
}

/**
 * Clean up all test data
 */
export async function cleanupDatabase() {
  await prisma.codeConflict.deleteMany()
  await prisma.pullRequestDependency.deleteMany()
  await prisma.pullRequest.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.phrase.deleteMany()
  await prisma.issue.deleteMany()
  await prisma.$executeRaw`DELETE FROM users`
}
