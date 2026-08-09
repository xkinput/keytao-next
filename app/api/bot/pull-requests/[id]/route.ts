import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { BatchContentLockedError, claimBatchContentMutation } from '@/lib/services/batchContentGuard'
import {
  assertExpectedBatchTargets,
  BatchTargetChangedError,
  parseExpectedBatchTargets,
} from '@/lib/services/batchDeleteTargets'
import {
  getPhraseWeightValidationError,
  isValidPhraseType,
  type PhraseType,
} from '@/lib/constants/phraseTypes'

type ExpectedWeightTarget = {
  id: number
  word: string
  code: string
  action: string
  type: PhraseType
  weight: number | null
}

function parseExpectedWeightTarget(value: unknown): ExpectedWeightTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  if (
    !Number.isInteger(target.id)
    || typeof target.word !== 'string'
    || typeof target.code !== 'string'
    || typeof target.action !== 'string'
    || typeof target.type !== 'string'
    || !isValidPhraseType(target.type)
    || !(
      target.weight === null
      || (Number.isInteger(target.weight) && typeof target.weight === 'number')
    )
  ) {
    return null
  }
  return target as ExpectedWeightTarget
}

/**
 * Bot API: update the weight of one exact server-known draft item.
 * PATCH /api/bot/pull-requests/:id
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rawBody = await request.clone().text()
    const prId = Number(id)
    const body: unknown = await request.json().catch(() => null)
    if (!Number.isInteger(prId) || prId <= 0 || !body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: '权重调整请求格式错误' }, { status: 400 })
    }
    const payload = body as Record<string, unknown>
    const {
      platform,
      platformId,
      batchId,
      expectedContentVersion,
      weight,
    } = payload
    const expectedTarget = parseExpectedWeightTarget(payload.expectedTarget)
    if (
      typeof platform !== 'string'
      || typeof platformId !== 'string'
      || typeof batchId !== 'string'
      || !Number.isInteger(expectedContentVersion)
      || (expectedContentVersion as number) < 0
      || !expectedTarget
      || expectedTarget.id !== prId
    ) {
      return NextResponse.json({ success: false, message: '权重调整目标快照格式错误' }, { status: 400 })
    }
    const weightError = getPhraseWeightValidationError(weight, expectedTarget.type)
    if (weightError) {
      return NextResponse.json({ success: false, message: weightError }, { status: 400 })
    }

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody })
    if (!auth.authorized) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status })
    }
    const user = auth.user

    await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, batchId, {
        creatorId: user.id,
        expectedContentVersion: expectedContentVersion as number,
        allowedStatuses: ['Draft'],
      })
      const current = await tx.pullRequest.findFirst({
        where: { id: prId, batchId, userId: user.id },
        select: { id: true, word: true, code: true, action: true, type: true, weight: true },
      })
      if (
        !current
        || current.id !== expectedTarget.id
        || (current.word ?? '') !== expectedTarget.word
        || (current.code ?? '') !== expectedTarget.code
        || current.action !== expectedTarget.action
        || (current.type ?? 'Phrase') !== expectedTarget.type
        || current.weight !== expectedTarget.weight
      ) {
        throw new BatchTargetChangedError()
      }
      const updated = await tx.pullRequest.updateMany({
        where: { id: prId, batchId, userId: user.id },
        data: { weight: weight as number },
      })
      if (updated.count !== 1) throw new BatchTargetChangedError()
    })

    return NextResponse.json({
      success: true,
      batchId,
      contentVersion: (expectedContentVersion as number) + 1,
      word: expectedTarget.word,
      code: expectedTarget.code,
      type: expectedTarget.type,
      weight,
      message: `已将“${expectedTarget.word}” ${expectedTarget.code} 的权重调整为 ${weight}`,
    })
  } catch (error) {
    if (error instanceof BatchContentLockedError || error instanceof BatchTargetChangedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    console.error('[Bot API] Update PR weight error:', error)
    return NextResponse.json({ success: false, message: '权重调整失败' }, { status: 500 })
  }
}

/**
 * Bot API: Delete a PR item from the user's draft batch
 * DELETE /api/bot/pull-requests/:id
 * Requires a valid Bot token and a bound platform user
 *
 * Only allows deletion if:
 * - The PR belongs to the caller's batch
 * - The batch is in Draft status
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rawBody = await request.clone().text()
    const prId = parseInt(id, 10)

    if (isNaN(prId)) {
      return NextResponse.json({ success: false, message: '无效的 PR ID' }, { status: 400 })
    }

    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 })
    }
    const payload = body as Record<string, unknown>
    const { platform, platformId, batchId, expectedContentVersion } = payload
    const expectedTargets = parseExpectedBatchTargets(payload.expectedTargets)
    if (
      typeof platform !== 'string'
      || typeof platformId !== 'string'
      || typeof batchId !== 'string'
      || !Number.isInteger(expectedContentVersion)
      || (expectedContentVersion as number) < 0
      || !expectedTargets
      || expectedTargets.length !== 1
      || expectedTargets[0].id !== prId
    ) {
      return NextResponse.json({ success: false, message: '删除目标快照格式错误' }, { status: 400 })
    }

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody })
    if (!auth.authorized) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status })
    }
    const user = auth.user

    await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, batchId, {
        creatorId: user.id,
        expectedContentVersion: expectedContentVersion as number,
      })
      const rows = await tx.pullRequest.findMany({
        where: { id: prId, batchId, userId: user.id },
        select: { id: true, word: true, code: true, action: true, type: true },
      })
      assertExpectedBatchTargets(expectedTargets, rows.map(row => ({
        id: row.id,
        word: row.word ?? '',
        code: row.code ?? '',
        action: row.action,
        type: row.type ?? 'Phrase',
      })))
      const deleted = await tx.pullRequest.deleteMany({ where: { id: prId, batchId, userId: user.id } })
      if (deleted.count !== 1) throw new BatchTargetChangedError()
    })

    const target = expectedTargets[0]
    console.log(`[Bot API] Deleted PR #${prId} (${target.action} "${target.word}") from batch ${batchId}`)

    return NextResponse.json({
      success: true,
      batchId,
      contentVersion: (expectedContentVersion as number) + 1,
      message: `已删除条目：${target.action} "${target.word}"（编码：${target.code}）`
    })
  } catch (error) {
    if (error instanceof BatchContentLockedError || error instanceof BatchTargetChangedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    console.error('[Bot API] Delete PR error:', error)
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json(
      { success: false, message: `删除失败：${errorMessage}` },
      { status: 500 }
    )
  }
}
