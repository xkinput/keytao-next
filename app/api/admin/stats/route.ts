import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'

export async function GET() {
  // 验证管理员权限
  const authCheck = await checkAdminPermission()
  if (!authCheck.authorized) {
    return authCheck.response
  }

  try {
    const [totalPhrases, totalIssues, totalUsers, totalPullRequests, pendingSyncBatches] = await Promise.all([
      prisma.phrase.count(),
      prisma.issue.count(),
      prisma.user.count(),
      prisma.pullRequest.count(),
      prisma.batch.count({
        where: {
          status: 'Approved',
          syncTaskId: null,
        },
      }),
    ])

    return NextResponse.json({
      totalPhrases,
      totalIssues,
      totalUsers,
      totalPullRequests,
      pendingSyncBatches,
    })
  } catch (error) {
    console.error('Get stats error:', error)
    return NextResponse.json(
      { error: '获取统计数据失败' },
      { status: 500 }
    )
  }
}
