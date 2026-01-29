'use client'

import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { apiRequest } from '@/lib/hooks/useSWR'

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isAuthenticated, clearAuth } = useAuthStore()

  // 判断是否在管理后台
  const isAdminArea = pathname.startsWith('/admin')

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
    } finally {
      clearAuth()
      router.push('/login')
    }
  }

  // 管理后台导航
  const adminNavItems = [
    { label: '首页', href: '/' },
    { label: '数据概览', href: '/admin/dashboard' },
    { label: '用户管理', href: '/admin/users' },
    { label: '词库管理', href: '/admin/phrases' },
    { label: '词库导入', href: '/admin/import' },
  ]

  // 普通导航
  const publicNavItems = [
    { label: '首页', href: '/' },
  ]

  const navItems = isAdminArea ? adminNavItems : publicNavItems

  return (
    <nav className="bg-content1 shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-2xl font-bold text-primary">
              KeyTao
            </Link>
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
