import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyApiKey } from '@/lib/apiKeyAuth'

export async function GET() {
  const auth = await verifyApiKey()
  if (!auth.success) return auth.response

  const phrases = await prisma.phrase.findMany({
    where: { status: 'Finish' },
    select: { id: true, word: true, code: true, type: true, weight: true, remark: true },
    orderBy: [{ code: 'asc' }, { weight: 'asc' }],
  })

  return NextResponse.json({ phrases, total: phrases.length })
}
