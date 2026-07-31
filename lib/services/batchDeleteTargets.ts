export interface ExpectedBatchTarget {
  id: number
  word: string
  code: string
  action: string
  type: string
}

export class BatchTargetChangedError extends Error {
  readonly status = 409

  constructor() {
    super('待删除条目已发生变化，请刷新草稿后重试')
    this.name = 'BatchTargetChangedError'
  }
}

export function assertExpectedBatchTargets(
  expected: ExpectedBatchTarget[],
  actual: ExpectedBatchTarget[]
): void {
  if (expected.length !== actual.length) {
    throw new BatchTargetChangedError()
  }

  const actualById = new Map(actual.map(item => [item.id, item]))
  const matches = expected.every((item) => {
    const row = actualById.get(item.id)
    return row
      && row.word === item.word
      && row.code === item.code
      && row.action === item.action
      && row.type === item.type
  })

  if (!matches || new Set(expected.map(item => item.id)).size !== expected.length) {
    throw new BatchTargetChangedError()
  }
}

export function parseExpectedBatchTargets(value: unknown): ExpectedBatchTarget[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const parsed: ExpectedBatchTarget[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if (
      Object.keys(record).some(key => !['id', 'word', 'code', 'action', 'type'].includes(key))
      || !Number.isInteger(record.id)
      || (record.id as number) <= 0
      || typeof record.word !== 'string'
      || typeof record.code !== 'string'
      || typeof record.action !== 'string'
      || typeof record.type !== 'string'
    ) return null
    parsed.push(record as unknown as ExpectedBatchTarget)
  }
  return parsed
}
