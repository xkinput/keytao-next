import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { detectPhraseType, getDefaultWeight, isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'

function normalizeDraftType(word: string, code: string, value: string | null): PhraseType {
  if (value && isValidPhraseType(value)) return value
  return detectPhraseType(word, code)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const batchId = typeof body.batchId === 'string' && body.batchId.trim() ? body.batchId.trim() : null
    const batch = batchId
      ? await prisma.batch.findFirst({
        where: { id: batchId, creatorId: session.id },
        include: { pullRequests: { orderBy: { createAt: 'asc' } } },
      })
      : await prisma.batch.findFirst({
        where: { creatorId: session.id, status: 'Draft' },
        orderBy: { updateAt: 'desc' },
        include: { pullRequests: { orderBy: { createAt: 'asc' } } },
      })

    if (!batch) {
      return NextResponse.json({ error: '没有找到可导入的草稿批次' }, { status: 404 })
    }

    let createdOrUpdated = 0
    let deleted = 0
    let skipped = 0

    await prisma.$transaction(async (tx) => {
      for (const item of batch.pullRequests) {
        const word = item.word?.trim() ?? ''
        const code = item.code?.trim() ?? ''
        if (!word || !code || /[\t\r\n]/.test(word) || /[\t\r\n]/.test(code)) {
          skipped += 1
          continue
        }

        const type = normalizeDraftType(word, code, item.type)

        if (item.action === 'Delete') {
          const result = await tx.userDictionaryEntry.deleteMany({
            where: { userId: session.id, word, code, type },
          })
          deleted += result.count
          continue
        }

        await tx.userDictionaryEntry.deleteMany({
          where: {
            userId: session.id,
            word,
            type,
            NOT: { code },
          },
        })

        await tx.userDictionaryEntry.upsert({
          where: {
            userId_word_code_type: {
              userId: session.id,
              word,
              code,
              type,
            },
          },
          update: {
            weight: item.weight ?? getDefaultWeight(type),
            remark: item.remark,
            replacePublic: true,
          },
          create: {
            userId: session.id,
            word,
            code,
            type,
            weight: item.weight ?? getDefaultWeight(type),
            remark: item.remark,
            replacePublic: true,
          },
        })
        createdOrUpdated += 1
      }
    })

    return NextResponse.json({
      batchId: batch.id,
      createdOrUpdated,
      deleted,
      skipped,
    })
  } catch (error) {
    console.error('Import user dictionary from draft error:', error)
    return NextResponse.json({ error: '从草稿导入用户词库失败' }, { status: 500 })
  }
}
