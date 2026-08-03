import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Pure unit tests: no database, no setup file, no dotenv.
 *
 * Integration tests that talk to a real PostgreSQL are excluded here because
 * they depend on `lib/test/setup.ts` (migrations + per-test cleanup), which
 * only the default `vitest.config.ts` wires up. Run those with `pnpm test`
 * after `docker compose -f docker-compose.test.yml up -d`.
 */
const DATABASE_BACKED_TESTS = [
  'app/api/batches/submit-and-approve.test.ts',
  'app/api/pull-requests/check-conflicts-batch/route.test.ts',
  'app/api/pull-requests/check-conflicts-batch/performance.test.ts',
  'lib/services/__tests__/batchApprovalTransaction.test.ts',
]

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    exclude: ['lib/test/**', 'node_modules/**', ...DATABASE_BACKED_TESTS],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
