import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  buildUserDictionaryYaml,
  KEYTAO_USER_DICT_FILE_NAME,
  KEYTAO_USER_DICT_NAME,
  USER_DICT_FILE_NAME,
  USER_DICT_NAME,
} from '@/lib/services/userDictionary'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const format = request.nextUrl.searchParams.get('format')
    const target = request.nextUrl.searchParams.get('target') === 'generic' ? 'generic' : 'keytao'
    const entries = await prisma.userDictionaryEntry.findMany({
      where: { userId: session.id },
      orderBy: [
        { type: 'asc' },
        { code: 'asc' },
        { word: 'asc' },
      ],
      select: {
        word: true,
        code: true,
        weight: true,
      },
    })

    const fileName = target === 'generic' ? USER_DICT_FILE_NAME : KEYTAO_USER_DICT_FILE_NAME
    const content = buildUserDictionaryYaml(entries, {
      name: target === 'generic' ? USER_DICT_NAME : KEYTAO_USER_DICT_NAME,
      title: target === 'generic' ? 'KeyTao generic user dictionary' : 'KeyTao user dictionary',
    })

    if (format === 'yaml') {
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/yaml; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      })
    }

    return NextResponse.json({
      fileName,
      content,
      count: entries.length,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Export user dictionary error:', error)
    return NextResponse.json({ error: '导出用户词库失败' }, { status: 500 })
  }
}
