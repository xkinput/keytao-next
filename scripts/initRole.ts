import 'dotenv/config'
import { prisma } from '../lib/prisma'
import { newEnforcer } from 'casbin'
import { PrismaAdapter } from 'casbin-prisma-adapter'
import { resolve } from 'path'

// User roles enum
enum UserRole {
  ROOT = 'R:ROOT',
  MANAGER = 'R:MANAGER',
  NORMAL = 'R:NORMAL',
}

async function main() {
  console.log('Starting role initialization...')

  // Create roles
  const roles = [
    {
      name: '初始管理员',
      value: UserRole.ROOT
    },
    {
      name: '管理员',
      value: UserRole.MANAGER
    },
    {
      name: '普通用户',
      value: UserRole.NORMAL
    },
  ]

  await prisma.role.createMany({
    data: roles,
    skipDuplicates: true
  })
  console.log('✓ Roles created')

  // Initialize Casbin enforcer with prisma instance
  const adapter = new PrismaAdapter(prisma)
  const confPath = resolve(__dirname, '../config/rbac_model.conf')
  const enforcer = await newEnforcer(confPath, adapter)
  console.log('✓ Casbin enforcer initialized')

  // Add policies for ROOT role
  const rootPolicies = [
    ['phrase:page', 'read'],
  ]

  for (const rule of rootPolicies) {
    await enforcer.addPolicy(UserRole.ROOT, rule[0], rule[1])
    console.log(`  ✓ Added policy for ROOT: [${UserRole.ROOT}, ${rule[0]}, ${rule[1]}]`)
  }

  // Add policies for NORMAL role
  const normalPolicies = [
    [UserRole.NORMAL, 'phrase', 'add'],
  ]

  for (const rule of normalPolicies) {
    await enforcer.addPolicy(rule[0], rule[1], rule[2])
    console.log(`  ✓ Added policy for NORMAL: [${rule[0]}, ${rule[1]}, ${rule[2]}]`)
  }

  console.log('✓ All roles and policies initialized successfully!')
}

main()
  .catch((e) => {
    console.error('Error initializing roles:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
