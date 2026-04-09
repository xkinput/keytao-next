// Load test environment variables FIRST before any imports
import { config } from 'dotenv'
config({ path: '.env.test' })

import { execSync } from 'child_process'
import { beforeAll, afterEach, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'

beforeAll(async () => {
  // Run migrations on test database.
  // If schema-engine binary is unavailable (e.g. NixOS), skip and assume the
  // test DB schema is already up to date (apply manually with prisma migrate deploy).
  try {
    execSync('pnpm prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
      timeout: 30_000,
    })
  } catch {
    console.warn('[test setup] prisma migrate deploy failed — assuming test DB schema is current.')
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
        casbin_rule,
        api_keys
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
