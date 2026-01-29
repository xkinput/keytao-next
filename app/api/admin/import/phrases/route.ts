import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'

export async function POST(request: NextRequest) {
  // 验证管理员权限
  const authCheck = await checkAdminPermission()
  if (!authCheck.authorized) {
    return authCheck.response
  }

  const session = authCheck.session!

  try {
    const { lines } = await request.json()

    if (!Array.isArray(lines)) {
      return NextResponse.json({ error: '无效的数据格式' }, { status: 400 })
    }

    let success = 0
    let failed = 0

    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length < 2) {
        failed++
        continue
      }

      const [word, code] = parts
      if (!word || !code) {
        failed++
        continue
      }

      try {
        await prisma.phrase.create({
          data: {
            word: word.trim(),
            code: code.trim(),
            type: 'Phrase',
            status: 'Draft',
            weight: 0,
            user: {
              connect: { id: session.id }
            }
          }
        })
        success++
      } catch {
        // Duplicate or other error
        failed++
      }
    }

    return NextResponse.json({ success, failed })
  } catch (error) {
    console.error('Import phrases error:', error)
    return NextResponse.json(
      { error: '导入失败' },
      { status: 500 }
    )
  }
}
