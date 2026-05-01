import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRootAdminPermission } from '@/lib/adminAuth'

// PATCH /api/sponsors/[id] — toggle visible or update fields
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkRootAdminPermission()
  if (!auth.authorized) return auth.response!

  const { id } = await params
  const sponsorId = parseInt(id)
  const body = await request.json()

  const sponsor = await prisma.sponsor.update({
    where: { id: sponsorId },
    data: {
      ...(body.payerName !== undefined && { payerName: body.payerName.trim() }),
      ...(body.remark !== undefined && { remark: body.remark?.trim() || null }),
      ...(body.amount !== undefined && { amount: Math.round(body.amount) }),
      ...(body.message !== undefined && { message: body.message?.trim() || null }),
      ...(body.channel !== undefined && { channel: body.channel }),
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
  await prisma.sponsor.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
