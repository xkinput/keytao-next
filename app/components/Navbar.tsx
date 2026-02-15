'use client'

import { useEffect, useMemo, useCallback, memo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI } from '@/lib/hooks/useSWR'
import Logo from './Logo'
import ThemeSwitch from './ThemeSwitch'

function Navbar() {
  const router = useRouter()
  const pathname = usePathname()

  // Only subscribe to needed fields to avoid unnecessary re-renders
  const user = useAuthStore(state => state.user)
  const token = useAuthStore(state => state.token)
  const isAdmin = useAuthStore(state => state.isAdmin)
  const isRootAdmin = useAuthStore(state => state.isRootAdmin)
  const adminChecked = useAuthStore(state => state._adminChecked)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const clearAuth = useAuthStore(state => state.clearAuth)
  const setAdminStatus = useAuthStore(state => state.setAdminStatus)

  const isAuthenticatedValue = isAuthenticated()

  // Only check admin status when authenticated and not yet checked
  const shouldCheckAdmin = isAuthenticatedValue && token && !adminChecked

  const { data: adminCheck } = useAPI<{
    totalPhrases: number
    totalIssues: number
    totalUsers: number
    totalPullRequests: number
    pendingSyncBatches: number
    isRootAdmin: boolean
  }>(
    shouldCheckAdmin ? '/api/admin/stats' : null,
    { refreshInterval: 0 }
  )

  // Update admin status when check completes
  useEffect(() => {
    if (adminCheck) {
      setAdminStatus(true, adminCheck.isRootAdmin || false)
    }
  }, [adminCheck, setAdminStatus])

  const handleLogout = useCallback(() => {
    clearAuth()
    router.push('/')
  }, [clearAuth, router])

  const handleLoginClick = useCallback(() => {
    router.push('/login')
  }, [router])

  const handleRegisterClick = useCallback(() => {
    router.push('/register')
  }, [router])

  const isAdminArea = pathname.startsWith('/admin')

  // Memoize navigation items to avoid re-creating on every render
  const adminNavItems = useMemo(() => [
    { label: '首页', href: '/' },
    { label: '数据概览', href: '/admin/dashboard' },
    { label: '批次审核', href: '/admin/batches' },
    { label: '用户管理', href: '/admin/users' },
    ...(isRootAdmin ? [{ label: '词库导入', href: '/admin/import' }] : []),
  ], [isRootAdmin])

  const publicNavItems = useMemo(() => [
    { label: '改词', href: '/' },
    { label: '讨论', href: '/issues' },
    { label: '修改提议', href: '/pull-requests' },
    { label: '词库管理', href: '/phrases' },
    { label: 'GitHub 同步', href: '/sync' },
    { label: '安装配置', href: '/install' },
  ], [])

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
                  prefetch={false}
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
                  prefetch={false}
                  className="px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  管理后台
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitch />
            {isAuthenticatedValue ? (
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
                  onPress={handleLoginClick}
                >
                  登录
                </Button>
                <Button
                  color="primary"
                  size="sm"
                  onPress={handleRegisterClick}
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

export default memo(Navbar)
