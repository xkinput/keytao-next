import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRootAdminPermission } from '@/lib/adminAuth'

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

  if (!payerName?.trim()) {
    return NextResponse.json({ error: '付款姓名不能为空' }, { status: 400 })
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: '金额必须为正整数' }, { status: 400 })
  }

  const sponsor = await prisma.sponsor.create({
    data: {
      payerName: payerName.trim(),
      remark: remark?.trim() || null,
      amount: Math.round(amount),
      message: message?.trim() || null,
      channel: channel || 'other',
      visible: visible !== false,
    },
  })

  return NextResponse.json(sponsor, { status: 201 })
}
