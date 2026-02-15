import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'

export async function GET() {
  // 验证管理员权限
  const authCheck = await checkAdminPermission()
  if (!authCheck.authorized) {
    return authCheck.response
  }

  const { user } = authCheck
  const isRootAdmin = user?.roles.some((role: { value: string }) => role.value === "R:ROOT")

  try {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [
      totalPhrases,
      totalIssues,
      totalUsers,
      totalPullRequests,
      pendingSyncBatches,
      syncedBatches,
      phrasesByType,
      batchesByStatus,
      totalBatches,
      recentSubmittedBatches,
      recentApprovedBatches,
    ] = await Promise.all([
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
      // 已同步批次数量
      prisma.batch.count({
        where: {
          syncTaskId: { not: null },
        },
      }),
      // 各类型词条数量
      prisma.phrase.groupBy({
        by: ['type'],
        _count: { id: true },
      }),
      // 各状态批次数量
      prisma.batch.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      // 批次总数
      prisma.batch.count(),
      // 近7天提交的批次数量
      prisma.batch.count({
        where: {
          status: { in: ['Submitted', 'Approved', 'Rejected', 'Published'] },
          updateAt: { gte: sevenDaysAgo },
        },
      }),
      // 近7天通过的批次数量
      prisma.batch.count({
        where: {
          status: 'Approved',
          updateAt: { gte: sevenDaysAgo },
        },
      }),
    ])

    // 转换词条类型统计为对象
    const phraseTypeStats = phrasesByType.reduce((acc, item) => {
      acc[item.type] = item._count.id
      return acc
    }, {} as Record<string, number>)

    // 转换批次状态统计为对象
    const batchStatusStats = batchesByStatus.reduce((acc, item) => {
      acc[item.status] = item._count.id
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({
      totalPhrases,
      totalIssues,
      totalUsers,
      totalPullRequests,
      totalBatches,
      pendingSyncBatches,
      syncedBatches,
      phrasesByType: phraseTypeStats,
      batchesByStatus: batchStatusStats,
      recentStats: {
        submittedBatches: recentSubmittedBatches,
        approvedBatches: recentApprovedBatches,
      },
      isRootAdmin,
    })
  } catch (error) {
    console.error('Get stats error:', error)
    return NextResponse.json(
      { error: '获取统计数据失败' },
      { status: 500 }
    )
  }
}
