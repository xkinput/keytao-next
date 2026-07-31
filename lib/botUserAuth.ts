import { verifyBotToken } from '@/lib/botAuth'
import { isValidPlatform, resolveUserByPlatform, type BotPlatform, type BotUserBasic } from '@/lib/botUserResolver'
import { verifyWebBotDelegation } from '@/lib/botUserDelegation'

export type BotUserAuthResult =
  | { authorized: true; user: BotUserBasic; platform: BotPlatform }
  | { authorized: false; status: number; message: string }

export async function requireVerifiedBotUser(
  platform: string | null | undefined,
  platformId: string | null | undefined,
  delegation?: { request: Request; rawBody: string },
): Promise<BotUserAuthResult> {
  if (!await verifyBotToken()) {
    return { authorized: false, status: 401, message: '未授权' }
  }

  if (!platform || !platformId) {
    return { authorized: false, status: 400, message: '缺少必需参数' }
  }

  if (!isValidPlatform(platform)) {
    return { authorized: false, status: 400, message: '不支持的平台' }
  }

  if (
    platform === 'web'
    && (!delegation || !verifyWebBotDelegation(delegation.request, platform, platformId, delegation.rawBody))
  ) {
    return { authorized: false, status: 401, message: 'Web 用户委托证明无效或已重放' }
  }

  const user = await resolveUserByPlatform(platform, platformId)
  if (!user) {
    return { authorized: false, status: 404, message: '未找到绑定账号，请先使用 /bind 命令绑定' }
  }

  return { authorized: true, user, platform }
}
