import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeUserDictionaryInput, UserDictionaryInputError } from '@/lib/services/userDictionary'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const entries = await prisma.userDictionaryEntry.findMany({
      where: { userId: session.id },
      orderBy: [
        { type: 'asc' },
        { code: 'asc' },
        { word: 'asc' },
      ],
    })

    return NextResponse.json({ entries, total: entries.length })
  } catch (error) {
    console.error('Get user dictionary error:', error)
    return NextResponse.json({ error: '获取用户词库失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const input = normalizeUserDictionaryInput(body)

    const entry = await prisma.$transaction(async (tx) => {
      if (input.replacePublic) {
        await tx.userDictionaryEntry.deleteMany({
          where: {
            userId: session.id,
            word: input.word,
            type: input.type,
            NOT: { code: input.code },
          },
        })
      }

      return await tx.userDictionaryEntry.upsert({
        where: {
          userId_word_code_type: {
            userId: session.id,
            word: input.word,
            code: input.code,
            type: input.type,
          },
        },
        update: {
          weight: input.weight,
          remark: input.remark,
          replacePublic: input.replacePublic,
        },
        create: {
          userId: session.id,
          word: input.word,
          code: input.code,
          type: input.type,
          weight: input.weight,
          remark: input.remark,
          replacePublic: input.replacePublic,
        },
      })
    })

    return NextResponse.json({ entry })
  } catch (error) {
    if (error instanceof UserDictionaryInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('Create user dictionary entry error:', error)
    return NextResponse.json({ error: '保存用户词条失败' }, { status: 500 })
  }
}
