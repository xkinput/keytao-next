export interface FieldIdentity {
  id: string
}

export interface FieldInferenceValues {
  word?: string | null
  code?: string | null
}

export interface FieldInferenceRequest {
  fieldId: string
  generation: number
  word: string
  code?: string
}

export class FieldInferenceRequestTracker {
  private readonly generations = new Map<string, number>()
  private nextGeneration = 0

  begin(fieldId: string, word: string, code?: string): FieldInferenceRequest {
    const generation = ++this.nextGeneration
    this.generations.set(fieldId, generation)
    return { fieldId, generation, word, ...(code === undefined ? {} : { code }) }
  }

  invalidate(fieldId: string): void {
    this.generations.set(fieldId, ++this.nextGeneration)
  }

  forget(fieldId: string): void {
    this.generations.delete(fieldId)
  }

  clear(): void {
    this.generations.clear()
  }

  isLatest(request: FieldInferenceRequest): boolean {
    return this.generations.get(request.fieldId) === request.generation
  }
}

export function findCurrentFieldIndex(
  fields: FieldIdentity[],
  values: FieldInferenceValues[],
  request: FieldInferenceRequest,
  tracker: FieldInferenceRequestTracker,
): number {
  if (!tracker.isLatest(request)) return -1

  const index = fields.findIndex(field => field.id === request.fieldId)
  if (index < 0) return -1

  const current = values[index]
  if (!current || (current.word ?? '').trim() !== request.word) return -1
  if (request.code !== undefined && (current.code ?? '').trim() !== request.code) return -1
  return index
}
