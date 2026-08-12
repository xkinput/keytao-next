import fs from 'node:fs'
import path from 'node:path'
import {
  parseCedictPronunciations,
  parseColonPronunciations,
  parseJiebaFrequencies,
  type FrequencyImportRow,
  type PronunciationDataset,
  type PronunciationImportRow,
} from './referenceDataImport'

const BATCH_SIZE = 5_000

interface PronunciationFile {
  filename: string
  source: PronunciationDataset
  parse(content: string): PronunciationImportRow[]
}

interface QueryResult<Row> {
  rows: Row[]
  rowCount?: number | null
  affectedRows?: number
}

export interface ReferenceDataSqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

export interface ReferenceDataImportSummary {
  parsedPronunciationRows: number
  storedPronunciationRows: number
  storedFrequencyRows: number
}

export interface ReferenceDataParseSummary {
  parsedPronunciationRows: number
  parsedFrequencyRows: number
}

const PRONUNCIATION_FILES: PronunciationFile[] = [
  {
    filename: 'large_pinyin.txt',
    source: 'large_pinyin',
    parse: content => parseColonPronunciations(content, 'large_pinyin'),
  },
  {
    filename: 'zdic_cibs.txt',
    source: 'zdic_cibs',
    parse: content => parseColonPronunciations(content, 'zdic_cibs'),
  },
  {
    filename: 'zdic_cybs.txt',
    source: 'zdic_cybs',
    parse: content => parseColonPronunciations(content, 'zdic_cybs'),
  },
  {
    filename: 'cedict.txt',
    source: 'cedict',
    parse: parseCedictPronunciations,
  },
]

function readDataFile(dataDirectory: string, filename: string): string {
  return fs.readFileSync(path.join(dataDirectory, filename), 'utf8')
}

async function insertPronunciations(
  client: ReferenceDataSqlClient,
  rows: PronunciationImportRow[],
): Promise<number> {
  let insertedRows = 0
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    const result = await client.query(
      `
        INSERT INTO "pronunciation_references" ("word", "reading", "source")
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])
        ON CONFLICT ("word", "reading", "source") DO NOTHING
      `,
      [
        batch.map(row => row.word),
        batch.map(row => row.reading),
        batch.map(row => row.source),
      ],
    )
    insertedRows += result.rowCount ?? result.affectedRows ?? 0
  }
  return insertedRows
}

async function insertFrequencies(
  client: ReferenceDataSqlClient,
  rows: FrequencyImportRow[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    await client.query(
      `
        INSERT INTO "corpus_frequencies" ("word", "frequency")
        SELECT * FROM UNNEST($1::text[], $2::integer[])
        ON CONFLICT ("word") DO UPDATE SET "frequency" = EXCLUDED."frequency"
      `,
      [
        batch.map(row => row.word),
        batch.map(row => row.frequency),
      ],
    )
  }
}

export function parseReferenceDataDirectory(
  dataDirectory: string,
  log: (message: string) => void = () => undefined,
): ReferenceDataParseSummary {
  let parsedPronunciationRows = 0
  for (const file of PRONUNCIATION_FILES) {
    const rows = file.parse(readDataFile(dataDirectory, file.filename))
    parsedPronunciationRows += rows.length
    log(`Parsed ${rows.length} rows from ${file.filename} (${file.source})`)
  }
  const frequencies = parseJiebaFrequencies(readDataFile(dataDirectory, 'jieba_dict.txt'))
  log(`Parsed ${frequencies.length} unique rows from jieba_dict.txt`)
  return { parsedPronunciationRows, parsedFrequencyRows: frequencies.length }
}

export async function importReferenceData(
  client: ReferenceDataSqlClient,
  dataDirectory: string,
  log: (message: string) => void = () => undefined,
): Promise<ReferenceDataImportSummary> {
  await client.query('BEGIN')
  try {
    await client.query('TRUNCATE TABLE "pronunciation_references", "corpus_frequencies"')

    let parsedPronunciationRows = 0
    let storedPronunciationRows = 0
    for (const file of PRONUNCIATION_FILES) {
      const rows = file.parse(readDataFile(dataDirectory, file.filename))
      parsedPronunciationRows += rows.length
      storedPronunciationRows += await insertPronunciations(client, rows)
      log(`Imported ${rows.length} parsed rows from ${file.filename} (${file.source})`)
    }

    const frequencies = parseJiebaFrequencies(readDataFile(dataDirectory, 'jieba_dict.txt'))
    await insertFrequencies(client, frequencies)
    log(`Imported ${frequencies.length} parsed rows from jieba_dict.txt`)

    await client.query('COMMIT')

    return {
      parsedPronunciationRows,
      storedPronunciationRows,
      storedFrequencyRows: frequencies.length,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
