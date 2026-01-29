import 'dotenv/config'
import { prisma } from '../lib/prisma'

async function main() {
  console.log('Starting permission initialization...')

  // Create permission actions
  const permissionActions = [
    {
      name: '创建',
      value: 'create',
    },
    {
      name: '读取',
      value: 'read'
    },
    {
      name: '修改',
      value: 'update'
    },
    {
      name: '删除',
      value: 'delete'
    },
    {
      name: '查询',
      value: 'query'
    },
  ]

  await prisma.permissionAction.createMany({
    data: permissionActions,
    skipDuplicates: true
  })
  console.log('✓ Permission actions created')

  // Create permissions
  const permissions = [
    {
      name: '用户列表页',
      value: 'user:page',
      actions: ['read']
    },
    {
      name: '用户',
      value: 'user',
      actions: ['create', 'read', 'update', 'delete']
    },
    {
      name: '权限页',
      value: 'permission:page',
      actions: ['read']
    },
    {
      name: '权限',
      value: 'permission',
      actions: ['create', 'read', 'update', 'delete']
    },
    {
      name: '权限操作页',
      value: 'permissionAction:page',
      actions: ['read']
    },
    {
      name: '权限操作',
      value: 'permissionAction',
      actions: ['create', 'read', 'update', 'delete']
    },
    {
      name: '授权管理页',
      value: 'userEmpowerment:page',
      actions: ['read']
    },
    {
      name: '角色',
      value: 'role',
      actions: ['create', 'read', 'update', 'delete']
    },
  ]

  for (const permission of permissions) {
    const exists = await prisma.permission.count({
      where: { value: permission.value }
    })

    if (exists) {
      console.log(`  - Permission "${permission.name}" already exists, skipping`)
      continue
    }

    await prisma.permission.create({
      data: {
        name: permission.name,
        value: permission.value,
        actions: {
          connect: permission.actions.map(it => ({ value: it }))
        }
      },
    })
    console.log(`  ✓ Created permission: ${permission.name}`)
  }

  console.log('✓ All permissions initialized successfully!')
}

main()
  .catch((e) => {
    console.error('Error initializing permissions:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
