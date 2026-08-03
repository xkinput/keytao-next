import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockVerifyBotToken = vi.fn()
const mockResolveUserByPlatform = vi.fn()
const mockVerifyWebBotDelegation = vi.fn()

vi.mock('@/lib/botAuth', () => ({
  verifyBotToken: mockVerifyBotToken,
}))

vi.mock('@/lib/botUserResolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/botUserResolver')>()
  return { ...actual, resolveUserByPlatform: mockResolveUserByPlatform }
})

vi.mock('@/lib/botUserDelegation', () => ({
  verifyWebBotDelegation: mockVerifyWebBotDelegation,
}))

const { requireVerifiedBotUser } = await import('@/lib/botUserAuth')
const { hasRole } = await import('@/lib/botUserResolver')

const botUser = {
  id: 7,
  name: '喵喵Bot',
  nickname: '喵喵Bot',
  roles: [{ value: 'R:NORMAL' }, { value: 'R:BOT' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockVerifyBotToken.mockResolvedValue(true)
  mockResolveUserByPlatform.mockResolvedValue(botUser)
  mockVerifyWebBotDelegation.mockReturnValue(true)
})

describe('requireVerifiedBotUser', () => {
  it('rejects a missing or invalid bot token before touching the database', async () => {
    mockVerifyBotToken.mockResolvedValue(false)

    const result = await requireVerifiedBotUser('qq', '123')

    expect(result).toMatchObject({ authorized: false, status: 401 })
    expect(mockResolveUserByPlatform).not.toHaveBeenCalled()
  })

  it('rejects the web pseudo-platform without a signed delegation', async () => {
    const result = await requireVerifiedBotUser('web', '7')

    expect(result).toMatchObject({ authorized: false, status: 401 })
    expect(mockResolveUserByPlatform).not.toHaveBeenCalled()
  })

  it('rejects an invalid web delegation before resolving the user', async () => {
    mockVerifyWebBotDelegation.mockReturnValue(false)
    const request = new Request('https://keytao.test/api/bot/test', { method: 'POST' })

    const result = await requireVerifiedBotUser('web', '7', { request, rawBody: '{}' })

    expect(result).toMatchObject({ authorized: false, status: 401 })
    expect(mockResolveUserByPlatform).not.toHaveBeenCalled()
  })

  it('accepts web only with a valid signed delegation', async () => {
    const request = new Request('https://keytao.test/api/bot/test', { method: 'POST' })

    const result = await requireVerifiedBotUser('web', '7', { request, rawBody: '{}' })

    expect(result).toMatchObject({ authorized: true, platform: 'web' })
    expect(mockVerifyWebBotDelegation).toHaveBeenCalledWith(request, 'web', '7', '{}')
  })

  it.each(['qq', 'telegram'] as const)('accepts %s with bot authentication', async (platform) => {
    const result = await requireVerifiedBotUser(platform, 'external-id')

    expect(result).toMatchObject({ authorized: true, platform })
  })

  it('rejects an unknown platform', async () => {
    const result = await requireVerifiedBotUser('discord', '1')
    expect(result).toMatchObject({ authorized: false, status: 400, message: '不支持的平台' })
  })

  it('returns 404 when the platform id is not bound to any enabled account', async () => {
    mockResolveUserByPlatform.mockResolvedValue(null)
    const result = await requireVerifiedBotUser('qq', '123')
    expect(result).toMatchObject({ authorized: false, status: 404 })
  })
})

describe('hasRole', () => {
  it('recognises the dedicated bot role', () => {
    expect(hasRole(botUser, 'R:BOT')).toBe(true)
  })

  it('rejects an ordinary bound contributor', () => {
    expect(hasRole({ roles: [{ value: 'R:NORMAL' }] }, 'R:BOT')).toBe(false)
  })
})
