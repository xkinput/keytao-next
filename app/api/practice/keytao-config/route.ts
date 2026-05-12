import { readFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'

interface SplitEntry {
  c1: string
  c2: string
}

function parseRootCsv(content: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of content.trim().split(/\r?\n/).slice(1)) {
    const [root, code] = line.split(',').map((part) => part.trim())
    if (root && code) map[root] = code
  }
  return map
}

function parseSplitCsv(content: string): Record<string, SplitEntry> {
  const map: Record<string, SplitEntry> = {}
  for (const line of content.trim().split(/\r?\n/).slice(1)) {
    const [phrase, c1 = '', c2 = ''] = line.split(',').map((part) => part.trim())
    if (phrase) map[phrase] = { c1, c2 }
  }
  return map
}

export async function GET() {
  const configDir = path.join(process.cwd(), 'config')
  const [rootCsv, splitCsv] = await Promise.all([
    readFile(path.join(configDir, 'keytao-root.csv'), 'utf-8'),
    readFile(path.join(configDir, 'keytao-split.csv'), 'utf-8'),
  ])

  return NextResponse.json({
    rootMap: parseRootCsv(rootCsv),
    splitMap: parseSplitCsv(splitCsv),
  })
}