'use client'

import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI } from '@/lib/hooks/useSWR'
import Logo from './Logo'

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isAuthenticated, clearAuth, token } = useAuthStore()

  // 判断是否在管理后台
  const isAdminArea = pathname.startsWith('/admin')

  // 检查是否是管理员
  const { data: adminCheck } = useAPI(
    isAuthenticated() && token ? '/api/admin/stats' : null
  )
  const isAdmin = !!adminCheck

  const handleLogout = async () => {
    // Client-only logout: clear local token and redirect
    clearAuth()
    router.push('/')
  }

  // 管理后台导航
  const adminNavItems = [
    { label: '首页', href: '/' },
    { label: '数据概览', href: '/admin/dashboard' },
    { label: '批次审核', href: '/admin/batches' },
    { label: '用户管理', href: '/admin/users' },
    { label: '词库管理', href: '/admin/phrases' },
    { label: '词库导入', href: '/admin/import' },
    { label: 'GitHub 同步', href: '/admin/sync' },
  ]

  // 普通导航
  const publicNavItems = [
    { label: '改词', href: '/' },
    { label: '讨论', href: '/issues' },
    { label: '修改提议', href: '/pull-requests' },
  ]

  const navItems = isAdminArea ? adminNavItems : publicNavItems

  return (
    <nav className="bg-content1 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <Logo />
            <div className="hidden md:flex gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${pathname === item.href
                    ? 'bg-primary text-primary-foreground'
                    : 'text-default-700 hover:bg-default-100'
                    }`}
                >
                  {item.label}
                </Link>
              ))}
              {!isAdminArea && isAdmin && (
                <Link
                  href="/admin"
                  className="px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  管理后台
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated() ? (
              <>
                <span className="text-sm text-default-500">
                  {user?.nickname || user?.name}
                </span>
                <Button color="danger" variant="light" size="sm" onPress={handleLogout}>
                  退出登录
                </Button>
              </>
            ) : (
              <>
                <Button
                  color="primary"
                  variant="flat"
                  size="sm"
                  onPress={() => router.push('/login')}
                >
                  登录
                </Button>
                <Button
                  color="primary"
                  size="sm"
                  onPress={() => router.push('/register')}
                >
                  注册
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
