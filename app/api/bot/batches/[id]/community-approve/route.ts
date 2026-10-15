import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import {
  isValidPlatform,
  resolveUserByPlatform,
  VERIFIED_BOT_PLATFORMS,
  type BotPlatform,
  type BotUserBasic,
} from '@/lib/botUserResolver'
import { PhraseWeightConflictError } from '@/lib/services/phraseWeightLock'
import {
  approveSubmittedBatch,
  BatchApprovalTargetChangedError,
  BatchApprovalMissingPhraseError,
  BatchConcurrentUpdateError,
  BatchNeedsManualReviewError,
  BatchTargetMismatchError,
  BatchUnresolvableTargetError,
  classifyBatchDeleteRisk,
} from '@/lib/services/batchApprovalService'

export const maxDuration = 30

type VoterIdentity = { platform: BotPlatform; platformId: string }

function isVoterIdentity(value: unknown): value is VoterIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const voter = value as Record<string, unknown>
  return Object.keys(voter).every(key => key === 'platform' || key === 'platformId')
    && typeof voter.platform === 'string'
    && isValidPlatform(voter.platform)
    && VERIFIED_BOT_PLATFORMS.includes(voter.platform)
    && typeof voter.platformId === 'string'
    && voter.platformId.trim().length > 0
}

function getErrorStatus(message: string): number {
  if (message === '批次不存在') return 404
  if (message === '只能审核待审核状态的批次') return 400
  if (message.startsWith('自动审核禁止纯删除项')) return 400
  return 500
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rawBody = await request.clone().text()
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 })
    }
    const allowedKeys = new Set(['platform', 'platformId', 'voters', 'expectedContentVersion'])
    if (Object.keys(body).some(key => !allowedKeys.has(key))) {
      return NextResponse.json({ success: false, message: '请求包含不支持的字段' }, { status: 400 })
    }
    const payload = body as Record<string, unknown>
    const { platform, platformId, voters, expectedContentVersion } = payload
    if (
      typeof platform !== 'string'
      || typeof platformId !== 'string'
      || !Number.isInteger(expectedContentVersion)
      || (expectedContentVersion as number) < 0
    ) {
      return NextResponse.json({ success: false, message: '请求字段类型错误' }, { status: 400 })
    }
    if (
      !Array.isArray(voters)
      || voters.length < 3
      || voters.length > 20
      || !voters.every(isVoterIdentity)
    ) {
      return NextResponse.json({
        success: false,
        message: '需要 3 至 20 位使用已绑定 QQ 或 Telegram 账号的投票人',
      }, { status: 400 })
    }

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody })
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: auth.status }
      )
    }
    const creator = auth.user

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        pullRequests: {
          orderBy: { createAt: 'asc' },
          select: { action: true, word: true, code: true, needsManualReview: true },
        },
      },
    })

    if (!batch) {
      return NextResponse.json({ success: false, message: '批次不存在' }, { status: 404 })
    }
    if (batch.creatorId !== creator.id) {
      return NextResponse.json({ success: false, message: '无权限操作此批次' }, { status: 403 })
    }
    if (batch.status !== 'Submitted') {
      return NextResponse.json({ success: false, message: '只能自动批准已提交审核的批次' }, { status: 400 })
    }
    if (batch.contentVersion !== expectedContentVersion) {
      return NextResponse.json({ success: false, message: '批次内容已被修改，请刷新后重试' }, { status: 409 })
    }

    const voterUsers = await Promise.all(
      voters.map(voter => resolveUserByPlatform(voter.platform, voter.platformId))
    )
    const unboundVoters = voters.filter((_, index) => !voterUsers[index])
    if (unboundVoters.length > 0) {
      return NextResponse.json({
        success: false,
        message: '投票人尚未绑定有效账号，请先使用 /bind 命令绑定',
        unboundVoters,
      }, { status: 400 })
    }
    const boundVoters = voterUsers.filter((voter): voter is BotUserBasic => voter !== null)
    const voterIds = new Set(boundVoters.map(voter => voter.id))
    if (voterIds.has(creator.id)) {
      return NextResponse.json({ success: false, message: '批次创建者不能参与投票' }, { status: 400 })
    }
    if (voterIds.size !== boundVoters.length || voterIds.size < 3) {
      return NextResponse.json({ success: false, message: '至少需要 3 位不同的投票人，投票人不能重复' }, { status: 400 })
    }

    const deleteRisk = classifyBatchDeleteRisk(batch.pullRequests)
    if (deleteRisk.hasBareDelete) {
      return NextResponse.json({
        success: false,
        message: '含纯删除项的批次不能投票通过，已保留给管理员审核',
        bareDeletes: deleteRisk.bareDeletes,
      }, { status: 400 })
    }

    const voterNames = boundVoters.map(voter => voter.nickname || voter.name || String(voter.id))
    const result = await approveSubmittedBatch({
      batchId: id,
      reviewNote: `群友投票通过：${voterNames.join('、')}`,
      mode: 'community-vote',
      allowDelete: false,
      expectedContentVersion: expectedContentVersion as number,
      reviewerId: creator.id,
    })

    return NextResponse.json({
      success: true,
      message: '批次已由群友投票审核通过',
      batch: {
        id: result.batch.id,
        status: result.batch.status,
      },
      voters: voterNames,
    })
  } catch (error) {
    if (error instanceof BatchConcurrentUpdateError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    if (error instanceof BatchApprovalTargetChangedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    if (error instanceof BatchNeedsManualReviewError) {
      return NextResponse.json(
        { success: false, message: error.message, needsManualReview: error.flagged },
        { status: error.status }
      )
    }
    if (error instanceof BatchUnresolvableTargetError) {
      return NextResponse.json(
        { success: false, message: error.message, unresolvable: error.items },
        { status: error.status }
      )
    }
    if (error instanceof PhraseWeightConflictError) {
      return NextResponse.json(
        { success: false, message: error.message, weightCollisions: error.collisions },
        { status: error.status }
      )
    }
    if (error instanceof BatchTargetMismatchError) {
      return NextResponse.json(
        { success: false, message: error.message, mismatches: error.mismatches },
        { status: error.status }
      )
    }
    if (error instanceof BatchApprovalMissingPhraseError) {
      return NextResponse.json(
        { success: false, message: error.message, missing: error.missing },
        { status: error.status }
      )
    }
    console.error('[Bot API] Community approve error:', error)
    const message = error instanceof Error ? error.message : '投票批准失败'
    return NextResponse.json(
      { success: false, message: `投票批准失败：${message}` },
      { status: getErrorStatus(message) }
    )
  }
}
