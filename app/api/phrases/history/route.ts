import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PUBLISHED_BATCH_WHERE } from '@/lib/batchPublished'

const publicUserSelect = { id: true, name: true, nickname: true } as const
const historySelect = {
  id: true,
  action: true,
  word: true,
  oldWord: true,
  code: true,
  type: true,
  weight: true,
  remark: true,
  status: true,
  createAt: true,
  user: { select: publicUserSelect },
  batch: {
    select: {
      id: true,
      description: true,
      status: true,
      createAt: true,
      reviewedAt: true,
      reviewNote: true,
      creator: { select: publicUserSelect },
      reviewer: { select: publicUserSelect },
      syncTask: { select: { status: true, completedAt: true } },
    },
  },
} satisfies Prisma.PullRequestSelect

export async function GET(request: NextRequest) {
  try {
    const word = (request.nextUrl.searchParams.get('word') || '').trim()
    const code = (request.nextUrl.searchParams.get('code') || '').trim()

    if (!word && !code) {
      return NextResponse.json({ error: '请填写词或编码' }, { status: 400 })
    }
    if (word.length > 50 || code.length > 50) {
      return NextResponse.json({ error: '词和编码最多各 50 个字符' }, { status: 400 })
    }

    const where: Prisma.PullRequestWhereInput = {
      ...(word ? { OR: [{ word }, { oldWord: word }] } : {}),
      ...(code ? { code } : {}),
    }
    const batchWhere = { status: { not: 'Draft' } } satisfies Prisma.BatchWhereInput

    // The top 200 of each partition contain the top 200 by reviewedAt ?? createAt.
    const [reviewed, unreviewed, current] = await Promise.all([
      prisma.pullRequest.findMany({
        where: { ...where, batch: { ...batchWhere, reviewedAt: { not: null } } },
        select: historySelect,
        orderBy: [{ batch: { reviewedAt: 'desc' } }, { id: 'desc' }],
        take: 200,
      }),
      prisma.pullRequest.findMany({
        where: { ...where, batch: { ...batchWhere, reviewedAt: null } },
        select: historySelect,
        orderBy: [{ createAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
      prisma.phrase.findMany({
        where: {
          ...(word ? { word } : {}),
          ...(code ? { code } : {}),
        },
        select: {
          id: true,
          word: true,
          code: true,
          type: true,
          weight: true,
          remark: true,
          updateAt: true,
        },
        orderBy: [{ code: 'asc' }, { weight: 'asc' }, { id: 'asc' }],
        take: 50,
      }),
    ])

    const entries = [...reviewed, ...unreviewed]
      .flatMap(({ user, batch, ...pr }) => {
        if (!batch) return []
        const { syncTask, reviewNote, ...publicBatch } = batch
        const published = batch.status === PUBLISHED_BATCH_WHERE.status
          && syncTask?.status === PUBLISHED_BATCH_WHERE.syncTask.status
        return [{
          ...pr,
          author: user,
          batch: {
            ...publicBatch,
            reviewNote: batch.status === 'Rejected' ? reviewNote : null,
            published,
            syncedAt: published ? syncTask?.completedAt ?? null : null,
          },
        }]
      })
      .sort((a, b) => (
        (b.batch.reviewedAt ?? b.createAt).getTime()
        - (a.batch.reviewedAt ?? a.createAt).getTime()
        || b.id - a.id
      ))
      .slice(0, 200)

    return NextResponse.json({ entries, current })
  } catch (error) {
    console.error('Get phrase history error:', error)
    return NextResponse.json({ error: '获取修改记录失败' }, { status: 500 })
  }
}
