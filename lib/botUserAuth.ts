import { getSession } from '@/lib/auth'
import { verifyApiKey } from '@/lib/apiKeyAuth'
import { verifyBotToken } from '@/lib/botAuth'
import { isValidPlatform, resolveUserByPlatform, type BotPlatform, type BotUserBasic } from '@/lib/botUserResolver'

export type BotUserAuthResult =
  | { authorized: true; user: BotUserBasic; platform: BotPlatform }
  | { authorized: false; status: number; message: string }

export async function requireVerifiedBotUser(
  platform: string | null | undefined,
  platformId: string | null | undefined,
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

  const user = await resolveUserByPlatform(platform, platformId)
  if (!user) {
    return { authorized: false, status: 404, message: '未找到绑定账号，请先使用 /bind 命令绑定' }
  }

  const session = await getSession()
  if (session) {
    if (session.id !== user.id) {
      return { authorized: false, status: 403, message: '登录 token 与平台绑定账号不匹配' }
    }
    return { authorized: true, user, platform }
  }

  const apiKey = await verifyApiKey()
  if (apiKey.success) {
    if (apiKey.ctx.userId !== user.id) {
      return { authorized: false, status: 403, message: 'API Key 与平台绑定账号不匹配' }
    }
    return { authorized: true, user, platform }
  }

  return { authorized: false, status: 401, message: '需要用户 token 或 API Key 验证本人身份' }
}
