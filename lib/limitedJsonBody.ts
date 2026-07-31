export class RequestBodyTooLargeError extends Error {
  readonly status = 413
}

export class InvalidJsonBodyError extends Error {
  readonly status = 400
}

export async function readLimitedJson(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const parsed = Number(declaredLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new RequestBodyTooLargeError('请求体过大')
    }
  }

  const reader = request.body?.getReader()
  if (!reader) throw new InvalidJsonBodyError('请求格式错误')
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new RequestBodyTooLargeError('请求体过大')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new InvalidJsonBodyError('请求格式错误')
  }
}
