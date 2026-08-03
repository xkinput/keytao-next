import { NextRequest, NextResponse } from 'next/server'

import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'
import type {
  BotBatchLookupByCodeRequest,
  BotBatchLookupByCodeResponse,
  BotLookupPhrase,
} from '@/lib/types/bot'

const MAX_BATCH_SIZE = 500
import { MAX_CODE_LENGTH_ANY_TYPE as MAX_CODE_LENGTH } from '@/lib/constants/codeValidation'

/**
 * Bot API: Batch lookup phrases by exact codes
 * POST /api/bot/phrases/by-code/batch
 * Requires Bot token authentication
 */
export async function POST(request: NextRequest) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json<BotBatchLookupByCodeResponse>(
        {
          success: false,
          count: 0,
          results: [],
          message: '未授权',
        },
        { status: 401 }
      )
    }

    const body: BotBatchLookupByCodeRequest = await request.json()
    const rawCodes = Array.isArray(body.codes) ? body.codes : []
    if (rawCodes.some((code) => typeof code !== 'string')) {
      return NextResponse.json<BotBatchLookupByCodeResponse>(
        {
          success: false,
          count: 0,
          results: [],
          message: '编码必须是字符串',
        },
        { status: 400 }
      )
    }

    const codes = rawCodes
      .map((code) => code.trim())
      .filter((code) => code.length > 0)

    if (codes.length === 0) {
      return NextResponse.json<BotBatchLookupByCodeResponse>(
        {
          success: false,
          count: 0,
          results: [],
          message: '缺少要查询的编码',
        },
        { status: 400 }
      )
    }

    if (codes.length > MAX_BATCH_SIZE) {
      return NextResponse.json<BotBatchLookupByCodeResponse>(
        {
          success: false,
          count: 0,
          results: [],
          message: `一次最多查询 ${MAX_BATCH_SIZE} 个编码`,
        },
        { status: 400 }
      )
    }

    if (codes.some((code) => code.length > MAX_CODE_LENGTH)) {
      return NextResponse.json<BotBatchLookupByCodeResponse>(
        {
          success: false,
          count: 0,
          results: [],
          message: '编码过长',
        },
        { status: 400 }
      )
    }

    const uniqueCodes = Array.from(new Set(codes))
    const phrases = await prisma.phrase.findMany({
      where: {
        code: {
          in: uniqueCodes,
        },
        status: 'Finish',
      },
      select: {
        word: true,
        code: true,
        weight: true,
        type: true,
        remark: true,
      },
      orderBy: [
        { code: 'asc' },
        { weight: 'asc' },
        { word: 'asc' },
      ],
    })

    const phraseMap = new Map<string, BotLookupPhrase[]>()

    for (const phrase of phrases) {
      const items = phraseMap.get(phrase.code) || []
      items.push({
        word: phrase.word,
        code: phrase.code,
        weight: phrase.weight,
        type: phrase.type,
        remark: phrase.remark,
      })
      phraseMap.set(phrase.code, items)
    }

    const results = codes.map((code) => ({
      code,
      phrases: [...(phraseMap.get(code) || [])].sort((left, right) => {
        if (left.weight !== right.weight) {
          return left.weight - right.weight
        }

        return left.word.localeCompare(right.word)
      }),
    }))

    return NextResponse.json<BotBatchLookupByCodeResponse>({
      success: true,
      count: results.length,
      results,
    })
  } catch (error) {
    console.error('[Bot API] Batch lookup by code error:', error)

    return NextResponse.json<BotBatchLookupByCodeResponse>(
      {
        success: false,
        count: 0,
        results: [],
        message: '查询失败',
      },
      { status: 500 }
    )
  }
}
