import 'dotenv/config'
import path from 'node:path'
import { Client } from 'pg'
import {
  importReferenceData,
  parseReferenceDataDirectory,
  type ReferenceDataSqlClient,
} from '../lib/reference-data/referenceDataImporter'

const REMOTE_IMPORT_ENV = 'REFERENCE_DATA_IMPORT_ALLOW_REMOTE'

function resolveDataDirectory(): string {
  const dataDirArgument = process.argv.find(argument => argument.startsWith('--data-dir='))
  if (dataDirArgument) return path.resolve(dataDirArgument.slice('--data-dir='.length))
  return path.join(process.cwd(), 'data', 'reference-review')
}

function assertImportTarget(connectionString: string): URL {
  const target = new URL(connectionString)
  const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
  if (!localHosts.has(target.hostname) && process.env[REMOTE_IMPORT_ENV] !== '1') {
    throw new Error(
      `Refusing non-local database host ${target.hostname}. Only the production orchestrator may set ${REMOTE_IMPORT_ENV}=1.`,
    )
  }
  return target
}

async function main(): Promise<void> {
  const dataDirectory = resolveDataDirectory()
  if (process.argv.includes('--dry-run')) {
    const summary = parseReferenceDataDirectory(dataDirectory, console.log)
    console.log(`Dry run complete: ${summary.parsedPronunciationRows} pronunciation rows and ${summary.parsedFrequencyRows} frequency rows.`)
    return
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const target = assertImportTarget(connectionString)
  const client = new Client({ connectionString })
  await client.connect()

  try {
    console.log(`Importing review references into ${target.hostname}/${target.pathname.slice(1)}`)
    console.log(`Reading vendored data from ${dataDirectory}`)
    const summary = await importReferenceData(
      client as unknown as ReferenceDataSqlClient,
      dataDirectory,
      console.log,
    )
    console.log(
      `Import complete: ${summary.storedPronunciationRows} pronunciation rows from ${summary.parsedPronunciationRows} parsed rows; ${summary.storedFrequencyRows} frequency rows.`,
    )
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('Reference review data import failed:', error)
  process.exitCode = 1
})
