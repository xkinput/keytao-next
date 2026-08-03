import { prisma } from '@/lib/prisma'

const VALID_PLATFORMS = ['qq', 'telegram', 'web'] as const
export type BotPlatform = typeof VALID_PLATFORMS[number]

/**
 * Platforms that are backed by a verified external identity (a QQ / Telegram
 * account bound through `/bind`). The `web` pseudo-platform only carries a
 * numeric user id supplied by the caller, so it must never be accepted on
 * privilege-escalating endpoints.
 */
export const VERIFIED_BOT_PLATFORMS: readonly BotPlatform[] = ['qq', 'telegram']

export function isValidPlatform(p: string | null): p is BotPlatform {
  return p !== null && (VALID_PLATFORMS as readonly string[]).includes(p)
}

export type BotUserBasic = {
  id: number
  name: string | null
  nickname: string | null
  roles: { value: string }[]
}

const USER_SELECT = {
  id: true,
  name: true,
  nickname: true,
  roles: { select: { value: true } },
} as const

/**
 * True when the resolved user carries the given role value (e.g. `R:BOT`).
 */
export function hasRole(user: Pick<BotUserBasic, 'roles'>, roleValue: string): boolean {
  return user.roles.some(role => role.value === roleValue)
}

export async function resolveUserByPlatform(
  platform: BotPlatform,
  platformId: string,
): Promise<BotUserBasic | null> {
  if (platform === 'web') {
    const userId = parseInt(platformId, 10)
    if (isNaN(userId)) return null
    return prisma.user.findFirst({ where: { id: userId, status: 'ENABLE' }, select: USER_SELECT })
  }
  if (platform === 'qq') {
    return prisma.user.findFirst({ where: { qqId: platformId, status: 'ENABLE' }, select: USER_SELECT })
  }
  return prisma.user.findFirst({ where: { telegramId: platformId, status: 'ENABLE' }, select: USER_SELECT })
}
