import 'dotenv/config'
import { prisma } from '../lib/prisma'
import { hashSync, genSaltSync } from 'bcrypt'
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
  console.log('Starting default user initialization...')

  const username = 'admin'
  const password = 'admin123'

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { name: username }
  })

  if (existingUser) {
    console.log(`  - User "${username}" already exists, skipping`)
    return
  }

  // Hash password
  const hashedPassword = hashSync(password, genSaltSync(12))

  // Get ROOT role
  const rootRole = await prisma.role.findUnique({
    where: { value: UserRole.ROOT }
  })

  if (!rootRole) {
    throw new Error('ROOT role not found. Please run init:role first.')
  }

  // Create admin user
  const user = await prisma.user.create({
    data: {
      name: username,
      nickname: 'Administrator',
      password: hashedPassword,
      status: 'ENABLE',
      signUpType: 'USERNAME',
      roles: {
        connect: {
          id: rootRole.id
        }
      }
    }
  })

  console.log(`  ✓ Created user: ${username} (ID: ${user.id})`)

  // Initialize Casbin enforcer and add user-role mapping
  const adapter = new PrismaAdapter(prisma)
  const confPath = resolve(__dirname, '../config/rbac_model.conf')
  const enforcer = await newEnforcer(confPath, adapter)

  await enforcer.addRoleForUser(username, UserRole.ROOT)
  console.log(`  ✓ Added role ${UserRole.ROOT} for user ${username}`)

  console.log('✓ Default admin user initialized successfully!')
  console.log(`\n  Username: ${username}`)
  console.log(`  Password: ${password}`)
}

main()
  .catch((e) => {
    console.error('Error initializing default user:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
