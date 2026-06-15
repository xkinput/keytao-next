import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRootAdminPermission } from '@/lib/adminAuth'

const MAX_NAME_LENGTH = 80
const MAX_MESSAGE_LENGTH = 500
const MAX_CHANNEL_LENGTH = 40

function parseSponsorId(id: string) {
  const sponsorId = parseInt(id, 10)
  return Number.isInteger(sponsorId) && sponsorId > 0 ? sponsorId : null
}

// PATCH /api/sponsors/[id] — toggle visible or update fields
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkRootAdminPermission()
  if (!auth.authorized) return auth.response!

  const { id } = await params
  const sponsorId = parseSponsorId(id)
  if (!sponsorId) return NextResponse.json({ error: '无效 ID' }, { status: 400 })
  const body = await request.json()

  for (const field of ['payerName', 'remark', 'message', 'channel'] as const) {
    if (body[field] !== undefined && typeof body[field] !== 'string') {
      return NextResponse.json({ error: `${field} 格式错误` }, { status: 400 })
    }
  }

  const payerName = body.payerName === undefined ? undefined : body.payerName.trim()
  const remark = body.remark === undefined ? undefined : body.remark.trim()
  const message = body.message === undefined ? undefined : body.message.trim()
  const channel = body.channel === undefined ? undefined : body.channel.trim()

  if (payerName !== undefined && (!payerName || payerName.length > MAX_NAME_LENGTH)) {
    return NextResponse.json({ error: '付款姓名格式错误' }, { status: 400 })
  }
  if ((remark !== undefined && remark.length > MAX_NAME_LENGTH) || (message !== undefined && message.length > MAX_MESSAGE_LENGTH) || (channel !== undefined && channel.length > MAX_CHANNEL_LENGTH)) {
    return NextResponse.json({ error: '字段内容过长' }, { status: 400 })
  }
  if (body.amount !== undefined && (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0)) {
    return NextResponse.json({ error: '金额必须为正整数' }, { status: 400 })
  }
  if (body.visible !== undefined && typeof body.visible !== 'boolean') {
    return NextResponse.json({ error: 'visible 必须是布尔值' }, { status: 400 })
  }

  const sponsor = await prisma.sponsor.update({
    where: { id: sponsorId },
    data: {
      ...(payerName !== undefined && { payerName }),
      ...(remark !== undefined && { remark: remark || null }),
      ...(body.amount !== undefined && { amount: Math.round(body.amount) }),
      ...(message !== undefined && { message: message || null }),
      ...(channel !== undefined && { channel }),
      ...(body.visible !== undefined && { visible: body.visible }),
    },
  })

  return NextResponse.json(sponsor)
}

// DELETE /api/sponsors/[id]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkRootAdminPermission()
  if (!auth.authorized) return auth.response!

  const { id } = await params
  const sponsorId = parseSponsorId(id)
  if (!sponsorId) return NextResponse.json({ error: '无效 ID' }, { status: 400 })
  await prisma.sponsor.delete({ where: { id: sponsorId } })
  return NextResponse.json({ ok: true })
}
