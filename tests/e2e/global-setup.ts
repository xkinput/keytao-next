import { config } from 'dotenv'
import { execSync } from 'child_process'
import { cleanupE2EData, ensureE2ERoles } from './helpers/e2e-data'

export default async function globalSetup() {
  config({ path: '.env.test' })
  config({ path: '.env' })

  try {
    execSync('pnpm prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
      timeout: 30_000,
    })
  } catch {
    console.warn('[e2e setup] prisma migrate deploy failed; assuming schema is current.')
  }

  await cleanupE2EData()
  await ensureE2ERoles()
}
