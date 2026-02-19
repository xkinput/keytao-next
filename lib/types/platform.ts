export type PlatformType = 'qq' | 'telegram'

export interface PlatformUser {
  platform: PlatformType
  platformId: string
  nickname?: string
  avatar?: string
}

export interface LinkKeyData {
  key: string
  expiresAt: Date
}

export interface BindResult {
  success: boolean
  message: string
  userId?: number
  userName?: string
  userNickname?: string
}

export interface UserFindResult {
  found: boolean
  message?: string
  user?: {
    id: number
    name: string | null
    nickname: string | null
    email: string | null
    createAt: Date
    roles: Array<{
      value: string
      name: string
    }>
  }
}
