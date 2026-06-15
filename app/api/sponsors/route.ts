import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRootAdminPermission } from '@/lib/adminAuth'

const MAX_NAME_LENGTH = 80
const MAX_MESSAGE_LENGTH = 500
const MAX_CHANNEL_LENGTH = 40

// GET /api/sponsors — public, returns visible sponsors
export async function GET() {
  const sponsors = await prisma.sponsor.findMany({
    where: { visible: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      payerName: true,
      remark: true,
      amount: true,
      message: true,
      channel: true,
      createdAt: true,
    },
  })

  // Display name: remark takes priority over payerName
  const result = sponsors.map(s => ({
    id: s.id,
    displayName: s.remark?.trim() || s.payerName,
    amount: s.amount,
    message: s.message,
    channel: s.channel,
    createdAt: s.createdAt,
  }))

  return NextResponse.json(result)
}

// POST /api/sponsors — root admin only, create a sponsor record
export async function POST(request: NextRequest) {
  const auth = await checkRootAdminPermission()
  if (!auth.authorized) return auth.response!

  const body = await request.json()
  const { payerName, remark, amount, message, channel, visible } = body
  const normalizedPayerName = typeof payerName === 'string' ? payerName.trim() : ''
  const normalizedRemark = typeof remark === 'string' ? remark.trim() : ''
  const normalizedMessage = typeof message === 'string' ? message.trim() : ''
  const normalizedChannel = typeof channel === 'string' ? channel.trim() : 'other'

  if (!normalizedPayerName) {
    return NextResponse.json({ error: '付款姓名不能为空' }, { status: 400 })
  }
  if (normalizedPayerName.length > MAX_NAME_LENGTH || normalizedRemark.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: '名称过长' }, { status: 400 })
  }
  if (normalizedMessage.length > MAX_MESSAGE_LENGTH || normalizedChannel.length > MAX_CHANNEL_LENGTH) {
    return NextResponse.json({ error: '留言或渠道过长' }, { status: 400 })
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: '金额必须为正整数' }, { status: 400 })
  }

  const sponsor = await prisma.sponsor.create({
    data: {
      payerName: normalizedPayerName,
      remark: normalizedRemark || null,
      amount: Math.round(amount),
      message: normalizedMessage || null,
      channel: normalizedChannel || 'other',
      visible: visible !== false,
    },
  })

  return NextResponse.json(sponsor, { status: 201 })
}
