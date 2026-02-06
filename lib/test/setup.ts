// Load test environment variables FIRST before any imports
import { config } from 'dotenv'
config({ path: '.env.test' })

import { execSync } from 'child_process'
import { beforeAll, afterEach, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'

beforeAll(async () => {
  // Run migrations on test database
  try {
    execSync('pnpm prisma migrate deploy', {
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL, // Ensure test DB URL is used
      },
      stdio: 'inherit',
    })
  } catch (error) {
    console.error('Failed to run migrations:', error)
    console.error('DATABASE_URL:', process.env.DATABASE_URL)
    throw error
  }
})

afterEach(async () => {
  // Clean up test data while preserving schema
  // Use TRUNCATE CASCADE for complete cleanup
  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE 
        code_conflicts,
        pull_request_dependencies,
        pull_requests,
        batches,
        phrases,
        issues,
        casbin_rule
      CASCADE
    `)

    // Delete only test users (those created during tests)
    await prisma.$executeRaw`DELETE FROM users WHERE email LIKE 'test_%@example.com'`
  } catch (error) {
    console.error('Cleanup error:', error)
    // Continue even if cleanup fails
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})
