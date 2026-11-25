import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'

type IdleDraft = {
  batchId: string
  creatorQqId: string
  itemCount: number
  lastModifiedAt: Date
  contentVersion: number
}

function publicBaseUrl() {
  const fallback = 'https://keytao.rea.ink'
  const configured = process.env.KEYTAO_PUBLIC_BASE_QQ?.trim() || fallback
  if (!URL.canParse(configured)) return fallback
  const url = new URL(configured)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return fallback
  return url.origin + url.pathname.replace(/\/+$/, '')
}

export async function GET(request: NextRequest) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 })
    }

    const params = request.nextUrl.searchParams
    const idleMinutes = Number(params.get('idleMinutes') ?? 20)
    const limit = Number(params.get('limit') ?? 50)
    if (!Number.isInteger(idleMinutes) || idleMinutes < 5 || idleMinutes > 1440 ||
        !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        { success: false, message: 'idleMinutes 须为 5 至 1440 的整数，limit 须为 1 至 100 的整数' },
        { status: 400 },
      )
    }

    const cutoff = new Date(Date.now() - idleMinutes * 60_000)
    const rows = await prisma.$queryRaw<IdleDraft[]>`
      SELECT b.id AS "batchId", u."qqId" AS "creatorQqId", COUNT(*)::int AS "itemCount",
        GREATEST(b."updateAt", MAX(pr."updateAt")) AS "lastModifiedAt", b."contentVersion"
      FROM batches b
      JOIN users u ON u.id = b."creatorId"
      JOIN pull_requests pr ON pr."batchId" = b.id
      WHERE b.status = 'Draft' AND u."qqId" IS NOT NULL AND b."updateAt" < ${cutoff}
      GROUP BY b.id, u."qqId"
      HAVING MAX(pr."updateAt") < ${cutoff}
      ORDER BY "lastModifiedAt" ASC, b.id ASC
      LIMIT ${limit}
    `
    const baseUrl = publicBaseUrl()
    const drafts = rows.map(draft => ({
      ...draft,
      lastModifiedAt: draft.lastModifiedAt.toISOString(),
      batchUrl: `${baseUrl}/batch/${encodeURIComponent(draft.batchId)}`,
    }))
    return NextResponse.json({ success: true, drafts }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[Bot API] Idle draft lookup failed:', error)
    return NextResponse.json({ success: false, message: '无法获取闲置草稿' }, { status: 500 })
  }
}
