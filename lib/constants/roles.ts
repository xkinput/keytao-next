// Role values stored in the `roles.value` column.
// Kept in one place so scripts and runtime guards cannot drift apart.

export const USER_ROLE = {
  /** Initial administrator. */
  ROOT: 'R:ROOT',
  /** Administrator. */
  MANAGER: 'R:MANAGER',
  /** Regular contributor. */
  NORMAL: 'R:NORMAL',
  /**
   * Machine account. Only accounts carrying this role may use the bot-only
   * privilege-escalating endpoints such as batch auto-approval.
   */
  BOT: 'R:BOT',
} as const

export type UserRoleValue = typeof USER_ROLE[keyof typeof USER_ROLE]

export const ADMIN_ROLE_VALUES: readonly string[] = [USER_ROLE.ROOT, USER_ROLE.MANAGER]
