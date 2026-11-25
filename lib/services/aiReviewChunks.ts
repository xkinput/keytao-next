export const AI_REVIEW_CHUNK_SIZE = 12

type ReviewSlotItem = {
  code?: string | null
  type?: string | null
  phrase?: { code: string } | null
}

export function aiReviewSlotKey(item: ReviewSlotItem): string {
  const code = (item.code || item.phrase?.code || '').toLowerCase()
  return code ? `${item.type || 'Phrase'}:${code}` : ''
}

export function chunkAiReviewTargets(targets: ReadonlyArray<ReviewSlotItem & { id: number }>): number[][] {
  const slots = new Map<string | number, number[]>()
  for (const target of targets) {
    const key = aiReviewSlotKey(target) || target.id
    const slot = slots.get(key)
    if (slot) slot.push(target.id)
    else slots.set(key, [target.id])
  }

  const chunks: number[][] = []
  let chunk: number[] = []
  for (const slot of slots.values()) {
    for (let offset = 0; offset < slot.length; offset += AI_REVIEW_CHUNK_SIZE) {
      const ids = slot.slice(offset, offset + AI_REVIEW_CHUNK_SIZE)
      if (chunk.length + ids.length > AI_REVIEW_CHUNK_SIZE) {
        chunks.push(chunk)
        chunk = []
      }
      chunk.push(...ids)
    }
  }
  if (chunk.length) chunks.push(chunk)
  return chunks
}
