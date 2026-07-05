import { config } from 'dotenv'
import { randomBytes } from 'crypto'
import { SignJWT } from 'jose'
import bcrypt from 'bcrypt'
import type { Page } from '@playwright/test'
import type { PrismaClient, User } from '@prisma/client'

config({ path: '.env.test' })
config({ path: '.env' })

export const E2E_PREFIX = 'e2e_keytao_next'

let prismaClient: PrismaClient | null = null

export async function getE2EPrisma() {
  if (!prismaClient) {
    const prismaModule = await import('../../../lib/prisma')
    prismaClient = prismaModule.prisma
  }
  return prismaClient
}

export interface E2EUser {
  id: number
  name: string
  email: string
  nickname: string
  password: string
  token: string
  isAdmin: boolean
  isRootAdmin: boolean
}

export interface E2ESeedData {
  owner: E2EUser
  rootAdmin: E2EUser
  normalUser: E2EUser
  phraseWord: string
  phraseCode: string
  issueTitle: string
  batchDescription: string
  pullRequestWord: string
  sponsorName: string
  syncMessage: string
}

function uniqueSuffix() {
  return `${Date.now()}_${randomBytes(4).toString('hex')}`
}

function jwtSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')
}

async function signE2EToken(user: Pick<User, 'id' | 'name'>) {
  return new SignJWT({ id: user.id, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(jwtSecret())
}

function e2eWhere() {
  return {
    OR: [
      { name: { startsWith: E2E_PREFIX } },
      { email: { startsWith: E2E_PREFIX } },
    ],
  }
}

export async function ensureE2ERoles() {
  const prisma = await getE2EPrisma()
  const roles = [
    { value: 'R:NORMAL', name: 'Normal User' },
    { value: 'R:MANAGER', name: 'Manager' },
    { value: 'R:ROOT', name: 'Root Admin' },
  ]

  for (const role of roles) {
    await prisma.role.upsert({
      where: { value: role.value },
      update: { name: role.name },
      create: role,
    })
  }
}

export async function cleanupE2EData() {
  const prisma = await getE2EPrisma()
  await prisma.sponsor.deleteMany({
    where: {
      OR: [
        { payerName: { startsWith: E2E_PREFIX } },
        { remark: { startsWith: E2E_PREFIX } },
      ],
    },
  })

  await prisma.user.deleteMany({ where: e2eWhere() })

  await prisma.syncTask.deleteMany({
    where: {
      OR: [
        { message: { startsWith: E2E_PREFIX } },
        { githubBranch: { startsWith: E2E_PREFIX } },
      ],
    },
  })
}

export async function createE2EUser(options?: {
  role?: 'normal' | 'manager' | 'root'
  suffix?: string
}) {
  const prisma = await getE2EPrisma()
  await ensureE2ERoles()

  const suffix = options?.suffix || uniqueSuffix()
  const roleValue = options?.role === 'root'
    ? 'R:ROOT'
    : options?.role === 'manager'
      ? 'R:MANAGER'
      : 'R:NORMAL'
  const role = await prisma.role.findUniqueOrThrow({ where: { value: roleValue } })
  const password = `Password_${suffix}!`
  const name = `${E2E_PREFIX}_${options?.role || 'normal'}_${suffix}`
  const email = `${E2E_PREFIX}_${options?.role || 'normal'}_${suffix}@example.com`
  const nickname = `E2E ${options?.role || 'normal'} ${suffix}`
  const user = await prisma.user.create({
    data: {
      name,
      email,
      nickname,
      password: await bcrypt.hash(password, 12),
      status: 'ENABLE',
      signUpType: 'USERNAME',
      roles: {
        connect: { id: role.id },
      },
    },
    include: {
      roles: true,
    },
  })

  return {
    id: user.id,
    name,
    email,
    nickname,
    password,
    token: await signE2EToken(user),
    isAdmin: roleValue === 'R:ROOT' || roleValue === 'R:MANAGER',
    isRootAdmin: roleValue === 'R:ROOT',
  } satisfies E2EUser
}

export async function seedE2EFeatureData() {
  const prisma = await getE2EPrisma()
  await cleanupE2EData()
  await ensureE2ERoles()

  const suffix = uniqueSuffix()
  const owner = await createE2EUser({ role: 'normal', suffix: `owner_${suffix}` })
  const rootAdmin = await createE2EUser({ role: 'root', suffix: `root_${suffix}` })
  const normalUser = await createE2EUser({ role: 'normal', suffix: `user_${suffix}` })

  const phraseWord = `端测词${suffix.slice(-4)}`
  const phraseCode = `e${suffix.slice(-6).replace(/[^a-z0-9]/gi, '').toLowerCase()}`
  await prisma.phrase.create({
    data: {
      word: phraseWord,
      code: phraseCode,
      type: 'Phrase',
      status: 'Finish',
      weight: 101,
      remark: `${E2E_PREFIX} public phrase`,
      userId: owner.id,
    },
  })

  const issueTitle = `${E2E_PREFIX} discussion ${suffix}`
  await prisma.issue.create({
    data: {
      title: issueTitle,
      content: 'E2E discussion content for public issue list.',
      status: true,
      authorId: owner.id,
    },
  })

  const syncTask = await prisma.syncTask.create({
    data: {
      status: 'Completed',
      progress: 100,
      message: `${E2E_PREFIX} sync completed ${suffix}`,
      githubPrUrl: 'https://github.com/xkinput/KeyTao/pull/1',
      githubPrNumber: 1,
      githubBranch: `${E2E_PREFIX}-${suffix}`,
      totalItems: 1,
      processedItems: 1,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  })

  const batchDescription = `${E2E_PREFIX} batch ${suffix}`
  const batch = await prisma.batch.create({
    data: {
      description: batchDescription,
      status: 'Submitted',
      creatorId: owner.id,
      syncTaskId: syncTask.id,
    },
  })

  const pullRequestWord = `提议词${suffix.slice(-4)}`
  await prisma.pullRequest.create({
    data: {
      word: pullRequestWord,
      code: `${phraseCode}a`,
      type: 'Phrase',
      status: 'Pending',
      action: 'Create',
      userId: owner.id,
      batchId: batch.id,
    },
  })

  const sponsorName = `${E2E_PREFIX} sponsor ${suffix}`
  await prisma.sponsor.create({
    data: {
      payerName: sponsorName,
      remark: sponsorName,
      amount: 66,
      message: 'E2E sponsor message',
      channel: 'wechat',
      visible: true,
    },
  })

  return {
    owner,
    rootAdmin,
    normalUser,
    phraseWord,
    phraseCode,
    issueTitle,
    batchDescription,
    pullRequestWord,
    sponsorName,
    syncMessage: syncTask.message!,
  } satisfies E2ESeedData
}

export async function authenticatePage(page: Page, user: E2EUser) {
  await suppressIntroModal(page)
  await page.addInitScript(({ authUser }) => {
    window.localStorage.setItem('auth-storage', JSON.stringify({
      state: {
        token: authUser.token,
        user: {
          id: authUser.id,
          name: authUser.name,
          nickname: authUser.nickname,
          email: authUser.email,
          roles: authUser.isRootAdmin
            ? [{ value: 'R:ROOT', name: 'Root Admin' }]
            : authUser.isAdmin
              ? [{ value: 'R:MANAGER', name: 'Manager' }]
              : [{ value: 'R:NORMAL', name: 'Normal User' }],
        },
        isAdmin: authUser.isAdmin,
        isRootAdmin: authUser.isRootAdmin,
        _adminChecked: true,
        _hasHydrated: true,
      },
      version: 0,
    }))
  }, { authUser: user })
}

export async function suppressIntroModal(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('keytao-intro-storage', JSON.stringify({
      state: {
        hasSeenIntro: true,
      },
      version: 0,
    }))
  })
}

export function authHeaders(user: E2EUser) {
  return {
    Authorization: `Bearer ${user.token}`,
  }
}

export function apiKeyValue() {
  return `kt_${randomBytes(24).toString('base64url')}`
}
