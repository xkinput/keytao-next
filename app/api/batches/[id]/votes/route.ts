import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export type BatchItemVoteChoice = 'like' | 'dislike' | null

export interface BatchItemVoteSummary {
  itemId: number
  likes: number
  dislikes: number
  vote: BatchItemVoteChoice
  canVote: boolean
}

type Context = { params: Promise<{ id: string }> }

function voteSelect(userId?: number) {
  return {
    id: true,
    status: true,
    userId: true,
    _count: { select: { likedBy: true, dislikedBy: true } },
    likedBy: { where: { id: userId ?? -1 }, select: { id: true } },
    dislikedBy: { where: { id: userId ?? -1 }, select: { id: true } },
  } as const
}

function summarize(item: {
  id: number
  _count: { likedBy: number; dislikedBy: number }
  likedBy: Array<{ id: number }>
  dislikedBy: Array<{ id: number }>
}, canVote: boolean): BatchItemVoteSummary {
  return {
    itemId: item.id,
    likes: item._count.likedBy,
    dislikes: item._count.dislikedBy,
    vote: item.likedBy.length > 0 ? 'like' : item.dislikedBy.length > 0 ? 'dislike' : null,
    canVote,
  }
}

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const [{ id }, session] = await Promise.all([params, getSession()])
    const batch = await prisma.batch.findUnique({
      where: { id },
      select: {
        status: true,
        creatorId: true,
        pullRequests: { select: voteSelect(session?.id) },
      },
    })
    if (!batch) return NextResponse.json({ error: '批次不存在' }, { status: 404 })

    const eligible = !!session && batch.status === 'Submitted' && session.id !== batch.creatorId
    return NextResponse.json({
      votes: batch.pullRequests.map(item => summarize(
        item,
        eligible && item.status === 'Pending' && session.id !== item.userId,
      )),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Get batch item votes error:', error)
    return NextResponse.json({ error: '无法读取投票' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const [{ id }, session, body] = await Promise.all([
      params,
      getSession(),
      request.json().catch(() => null) as Promise<{ itemId?: unknown; vote?: unknown } | null>,
    ])
    if (!session) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const itemId = body?.itemId
    const vote = body?.vote
    if (typeof itemId !== 'number' || !Number.isInteger(itemId) || itemId < 1 || itemId > 2147483647
      || (vote !== 'like' && vote !== 'dislike' && vote !== null)) {
      return NextResponse.json({ error: '投票参数无效' }, { status: 400 })
    }

    const result = await prisma.$transaction(async tx => {
      // Batch status transitions and review changes take this lock before changing any item.
      await tx.$queryRaw`SELECT "id" FROM "batches" WHERE "id" = ${id} FOR UPDATE`
      const batch = await tx.batch.findUnique({
        where: { id },
        select: { status: true, creatorId: true },
      })
      if (!batch) return { error: '批次不存在', status: 404 }

      const item = await tx.pullRequest.findFirst({
        where: { id: itemId, batchId: id },
        select: { status: true, userId: true },
      })
      if (!item) return { error: '词条不存在', status: 404 }
      if (session.id === batch.creatorId || session.id === item.userId) {
        return { error: '提交者不能给自己的词条投票', status: 403 }
      }
      if (batch.status !== 'Submitted' || item.status !== 'Pending') {
        return { error: '只有待审核的词条可以投票', status: 409 }
      }

      const user = { id: session.id }
      const updated = await tx.pullRequest.update({
        where: { id: itemId },
        data: {
          likedBy: vote === 'like' ? { connect: user } : { disconnect: user },
          dislikedBy: vote === 'dislike' ? { connect: user } : { disconnect: user },
        },
        select: voteSelect(session.id),
      })
      return { vote: summarize(updated, true) }
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('Save batch item vote error:', error)
    return NextResponse.json({ error: '投票失败，请重试' }, { status: 500 })
  }
}
