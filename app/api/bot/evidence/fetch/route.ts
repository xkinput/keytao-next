import { NextRequest, NextResponse } from 'next/server'

import { verifyBotToken } from '@/lib/botAuth'
import {
  fetchBotEvidence,
  isBotEvidenceSourceId,
  isValidBotEvidenceWord,
  type BotEvidenceFetchPayload,
} from '@/lib/services/botEvidenceFetch'

export const maxDuration = 30

function response(payload: BotEvidenceFetchPayload, status = 200): NextResponse {
  return NextResponse.json(payload, { status })
}

function hasExactRequestKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === 2 && keys[0] === 'sourceId' && keys[1] === 'word'
}

export async function POST(request: NextRequest) {
  if (!await verifyBotToken()) {
    return response({ ok: false, status: 401, text: '' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return response({ ok: false, status: 400, text: '' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return response({ ok: false, status: 400, text: '' }, 400)
  }

  const candidate = body as Record<string, unknown>
  if (
    !hasExactRequestKeys(candidate)
    || !isBotEvidenceSourceId(candidate.sourceId)
    || !isValidBotEvidenceWord(candidate.sourceId, candidate.word)
  ) {
    return response({ ok: false, status: 400, text: '' }, 400)
  }

  const result = await fetchBotEvidence(candidate.sourceId, candidate.word)
  return response(result, result.status === 502 ? 502 : 200)
}
