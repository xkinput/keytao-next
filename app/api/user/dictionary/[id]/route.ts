import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeUserDictionaryInput, UserDictionaryInputError } from '@/lib/services/userDictionary'

function parseEntryId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { id: rawId } = await params
    const id = parseEntryId(rawId)
    if (!id) {
      return NextResponse.json({ error: '词条 ID 无效' }, { status: 400 })
    }

    const existing = await prisma.userDictionaryEntry.findFirst({
      where: { id, userId: session.id },
    })
    if (!existing) {
      return NextResponse.json({ error: '词条不存在' }, { status: 404 })
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
            NOT: { id },
          },
        })
      }

      return await tx.userDictionaryEntry.update({
        where: { id },
        data: {
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

    console.error('Update user dictionary entry error:', error)
    return NextResponse.json({ error: '更新用户词条失败' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { id: rawId } = await params
    const id = parseEntryId(rawId)
    if (!id) {
      return NextResponse.json({ error: '词条 ID 无效' }, { status: 400 })
    }

    const result = await prisma.userDictionaryEntry.deleteMany({
      where: { id, userId: session.id },
    })

    if (result.count !== 1) {
      return NextResponse.json({ error: '词条不存在' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete user dictionary entry error:', error)
    return NextResponse.json({ error: '删除用户词条失败' }, { status: 500 })
  }
}
