import { prisma } from '@/lib/prisma'

const VALID_PLATFORMS = ['qq', 'telegram', 'web'] as const
export type BotPlatform = typeof VALID_PLATFORMS[number]

export function isValidPlatform(p: string | null): p is BotPlatform {
  return p !== null && (VALID_PLATFORMS as readonly string[]).includes(p)
}

export type BotUserBasic = { id: number; name: string | null; nickname: string | null }

const USER_SELECT = { id: true, name: true, nickname: true } as const

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
