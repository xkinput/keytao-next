import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRootAdminPermission } from '@/lib/adminAuth'

// GET /api/admin/sponsors — root admin only, returns all including hidden
export async function GET() {
  const auth = await checkRootAdminPermission()
  if (!auth.authorized) return auth.response!

  const sponsors = await prisma.sponsor.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(sponsors)
}
