import 'dotenv/config'
import { randomBytes } from 'crypto'
import { genSaltSync, hashSync } from 'bcrypt'
import { newEnforcer } from 'casbin'
import { PrismaAdapter } from 'casbin-prisma-adapter'
import { resolve } from 'path'
import { prisma } from '../lib/prisma'
import { USER_ROLE } from '../lib/constants/roles'

/**
 * Create (or repair) the dedicated 喵喵Bot machine account.
 *
 * The account carries both R:NORMAL (so it can own draft batches like any
 * contributor) and R:BOT (which is what
 * `/api/bot/batches/:id/auto-approve` checks before letting a batch be
 * self-approved).
 *
 * Environment variables:
 *   BOT_USER_NAME     display/login name, defaults to 喵喵Bot
 *   BOT_USER_EMAIL    optional email, defaults to <none>
 *   BOT_USER_PASSWORD optional password; a random one is generated and printed
 *                     exactly once when omitted
 *   BOT_QQ_ID         optional QQ id to bind, so the bot can call the
 *                     platform-bound endpoints as itself
 */

const DEFAULT_BOT_NAME = '喵喵Bot'

function generatePassword(): string {
  return randomBytes(24).toString('base64url')
}

async function main() {
  console.log('Starting bot user initialization...')

  const name = process.env.BOT_USER_NAME?.trim() || DEFAULT_BOT_NAME
  const email = process.env.BOT_USER_EMAIL?.trim() || undefined
  const qqId = process.env.BOT_QQ_ID?.trim() || undefined

  const providedPassword = process.env.BOT_USER_PASSWORD?.trim()
  const password = providedPassword || generatePassword()
  const hashedPassword = hashSync(password, genSaltSync(12))

  const roles = await prisma.role.findMany({
    where: { value: { in: [USER_ROLE.NORMAL, USER_ROLE.BOT] } },
    select: { id: true, value: true },
  })

  const missingRoles = [USER_ROLE.NORMAL, USER_ROLE.BOT].filter(
    value => !roles.some(role => role.value === value)
  )
  if (missingRoles.length > 0) {
    throw new Error(
      `Missing roles: ${missingRoles.join(', ')}. Please run "pnpm run init:role" first.`
    )
  }

  const existing = await prisma.user.findUnique({
    where: { name },
    select: {
      id: true,
      qqId: true,
      roles: { select: { value: true } },
      _count: { select: { batches: true, pullRequests: true, issues: true, comments: true } },
    },
  })

  let userId: number
  let createdPassword: string | undefined

  if (existing) {
    // Granting R:BOT means granting batch self-approval. Never hand that to an
    // account that merely happens to share the name: unless it already IS the
    // bot account, require an explicit --force from an operator who has checked
    // what they are escalating.
    const alreadyBot = existing.roles.some(role => role.value === USER_ROLE.BOT)
    const hasHumanActivity =
      existing._count.batches > 0 ||
      existing._count.pullRequests > 0 ||
      existing._count.issues > 0 ||
      existing._count.comments > 0
    const force = process.argv.includes('--force')

    if (!alreadyBot && hasHumanActivity && !force) {
      throw new Error(
        `Refusing to grant ${USER_ROLE.BOT} to the existing account "${name}" (ID: ${existing.id}): ` +
        `it already has contribution history ` +
        `(batches=${existing._count.batches}, pullRequests=${existing._count.pullRequests}, ` +
        `issues=${existing._count.issues}, comments=${existing._count.comments}), ` +
        `so it looks like a real user rather than a machine account.\n` +
        `Either set BOT_USER_NAME to a dedicated name, or re-run with --force ` +
        `if you are certain this account should become the bot.`
      )
    }

    // Idempotent repair: attach the roles (and optionally the QQ binding)
    // without touching the existing credentials.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        status: 'ENABLE',
        ...(qqId && qqId !== existing.qqId ? { qqId } : {}),
        roles: { connect: roles.map(role => ({ id: role.id })) },
      },
    })
    userId = existing.id
    console.log(
      `  - User "${name}" already exists (ID: ${userId}), roles ensured` +
      (force && hasHumanActivity ? ' (--force: escalated an account with existing history)' : '')
    )
  } else {
    const user = await prisma.user.create({
      data: {
        name,
        nickname: name,
        email,
        password: hashedPassword,
        status: 'ENABLE',
        signUpType: 'USERNAME',
        ...(qqId ? { qqId } : {}),
        roles: { connect: roles.map(role => ({ id: role.id })) },
      },
      select: { id: true },
    })
    userId = user.id
    createdPassword = providedPassword ? undefined : password
    console.log(`  ✓ Created bot user: ${name} (ID: ${userId})`)
  }

  // Mirror the role assignment into Casbin so policy checks agree with the
  // relational roles.
  const adapter = new PrismaAdapter(prisma)
  const confPath = resolve(__dirname, '../config/rbac_model.conf')
  const enforcer = await newEnforcer(confPath, adapter)
  await enforcer.addRoleForUser(name, USER_ROLE.NORMAL)
  await enforcer.addRoleForUser(name, USER_ROLE.BOT)
  console.log(`  ✓ Casbin roles ensured for ${name}`)

  console.log('✓ Bot user initialized successfully!')
  console.log(`\n  Name: ${name}`)
  if (email) console.log(`  Email: ${email}`)
  if (qqId) console.log(`  QQ ID: ${qqId}`)
  if (createdPassword) {
    console.log(`  Password (shown once, store it now): ${createdPassword}`)
  } else if (!existing) {
    console.log('  Password: taken from BOT_USER_PASSWORD')
  }
}

main()
  .catch((e) => {
    console.error('Error initializing bot user:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
