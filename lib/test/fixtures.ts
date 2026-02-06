import { TestPhraseData } from './helpers'

/**
 * Common test phrases for seeding
 */
export const basePhrases: TestPhraseData[] = [
  { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
  { word: '我', code: 'w', type: 'Single', weight: 10 },
  { word: '你', code: 'n', type: 'Single', weight: 10 },
  { word: '他', code: 't', type: 'Single', weight: 10 },
  { word: '测试', code: 'ceshi', type: 'Phrase', weight: 100 },
  { word: '代码', code: 'daima', type: 'Phrase', weight: 100 },
  { word: '编程', code: 'bianc', type: 'Phrase', weight: 100 },
]

/**
 * Phrases with potential conflicts
 */
export const conflictPhrases: TestPhraseData[] = [
  { word: '如果', code: 'rjgl', type: 'Phrase', weight: 100 },
  { word: '茹果', code: 'rjgl', type: 'Phrase', weight: 101 }, // Duplicate code
]

/**
 * Single character phrases
 */
export const singleCharPhrases: TestPhraseData[] = [
  { word: '我', code: 'w', type: 'Single', weight: 10 },
  { word: '你', code: 'n', type: 'Single', weight: 10 },
  { word: '他', code: 't', type: 'Single', weight: 10 },
  { word: '她', code: 't', type: 'Single', weight: 11 }, // Duplicate code with higher weight
]

/**
 * Test user credentials
 */
export const testUserCredentials = {
  name: 'testuser',
  email: 'test@example.com',
  password: 'password123',
}

/**
 * Admin user credentials
 */
export const adminUserCredentials = {
  name: 'admin',
  email: 'admin@example.com',
  password: 'admin123',
}
