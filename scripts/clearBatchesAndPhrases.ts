import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Load environment variables from .env file FIRST
config()

// Create Prisma client after environment variables are loaded
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

/**
 * Clear all batches and phrases from database
 * WARNING: This will delete all data including:
 * - Batches
 * - Pull Requests (cascaded from batches)
 * - Pull Request Dependencies (cascaded from PRs)
 * - Code Conflicts (cascaded from PRs)
 * - Phrases
 * 
 * Usage:
 *   pnpm tsx scripts/clearBatchesAndPhrases.ts
 */
async function clearBatchesAndPhrases() {
  try {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      console.error('❌ DATABASE_URL environment variable is not set')
      console.log('\nPlease create a .env file with DATABASE_URL or set it in your environment')
      console.log('Example: DATABASE_URL="postgresql://user:password@localhost:5432/keytao?schema=public"')
      process.exit(1)
    }

    // Extract database name from URL for confirmation
    const dbMatch = dbUrl.match(/\/([^/?]+)(\?|$)/)
    const dbName = dbMatch ? dbMatch[1] : 'unknown'

    console.log(`⚠️  About to clear batches and phrases from database: ${dbName}`)
    console.log('Starting to clear batches and phrases...')

    // Delete all batches (will cascade delete pull requests, dependencies, and conflicts)
    const batchResult = await prisma.batch.deleteMany({})
    console.log(`✓ Deleted ${batchResult.count} batches (with cascaded PRs)`)

    // Delete all phrases
    const phraseResult = await prisma.phrase.deleteMany({})
    console.log(`✓ Deleted ${phraseResult.count} phrases`)

    console.log('✓ All batches and phrases cleared successfully')
  } catch (error) {
    console.error('Error clearing data:', error)
    throw error
  }
}

clearBatchesAndPhrases()
  .then(() => {
    console.log('Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Failed:', error)
    process.exit(1)
  })
