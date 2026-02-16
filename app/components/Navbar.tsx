'use client'

import { useEffect, useMemo, useCallback, memo, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection } from '@heroui/react'
import { Menu, User, Database, Shield, ChevronDown, Edit, Download, BookOpen } from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI } from '@/lib/hooks/useSWR'
import Logo from './Logo'
import ThemeSwitch from './ThemeSwitch'

function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get documentation URL based on current host
  const docsUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'https://keytao-docs.vercel.app/'

    const host = window.location.host
    return host.includes('rea.ink')
      ? 'https://keytao-docs.rea.ink/'
      : 'https://keytao-docs.vercel.app/'
  }, [])

  // Only subscribe to needed fields to avoid unnecessary re-renders
  const user = useAuthStore(state => state.user)
  const token = useAuthStore(state => state.token)
  const isAdmin = useAuthStore(state => state.isAdmin)
  const isRootAdmin = useAuthStore(state => state.isRootAdmin)
  const adminChecked = useAuthStore(state => state._adminChecked)
  const clearAuth = useAuthStore(state => state.clearAuth)
  const setAdminStatus = useAuthStore(state => state.setAdminStatus)

  // Check authentication based on user and token directly from store
  const isAuthenticatedValue = !!user && !!token

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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    }
  }, [])

  const handleLogout = useCallback(() => {
    clearAuth()
    router.push('/')
  }, [clearAuth, router])

  const handleLoginClick = useCallback(() => {
    router.push('/login')
  }, [router])

  // Categorized navigation menu
  type MenuItem = { label: string; href: string; requireRootAdmin?: boolean; isExternal?: boolean }
  type MenuCategory = {
    key: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    requireAdmin?: boolean
    items: MenuItem[]
  }

  const menuCategories = useMemo<MenuCategory[]>(() => [
    {
      key: 'batches',
      label: '改词',
      icon: Edit,
      items: [
        { label: '改词', href: '/' },
        { label: '讨论', href: '/issues' },
        { label: '修改提议', href: '/pull-requests' },
      ]
    },
    {
      key: 'phrases',
      label: '词库',
      icon: Database,
      items: [
        { label: '词库管理', href: '/phrases' },
        { label: 'GitHub 同步', href: '/sync' },
      ]
    },
    {
      key: 'install',
      label: '安装',
      icon: Download,
      items: [
        { label: '安装', href: '/install' },
      ]
    },
    {
      key: 'docs',
      label: '文档',
      icon: BookOpen,
      items: [
        { label: '文档', href: docsUrl, isExternal: true },
      ]
    },
    {
      key: 'admin',
      label: '管理',
      icon: Shield,
      requireAdmin: true,
      items: [
        { label: '数据概览', href: '/admin/dashboard' },
        { label: '批次审核', href: '/admin/batches' },
        { label: '用户管理', href: '/admin/users' },
        { label: '词库导入', href: '/admin/import', requireRootAdmin: true },
      ]
    }
  ], [docsUrl])

  // Filter menu categories based on permissions
  const visibleMenuCategories = useMemo(() => {
    return menuCategories
      .map(category => {
        if (category.requireAdmin && !isAdmin) return null

        const filteredItems = category.items.filter(item => {
          if (item.requireRootAdmin) return isRootAdmin
          return true
        })

        return filteredItems.length > 0 ? { ...category, items: filteredItems } : null
      })
      .filter((c): c is MenuCategory => c !== null)
  }, [menuCategories, isAdmin, isRootAdmin])

  const handleMouseEnter = useCallback((key: string) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setOpenDropdown(key)
  }, [])

  const handleMouseLeave = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setOpenDropdown(null)
    }, 200)
  }, [])

  return (
    <nav className="bg-content1 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-4 md:gap-8">
            <Logo />
            {/* Desktop Navigation */}
            <div className="hidden md:flex gap-1 items-center">
              {visibleMenuCategories.map((category) => {
                const IconComponent = category.icon
                const firstItem = category.items[0]
                const firstHref = firstItem?.href
                const isSingleItem = category.items.length === 1

                // Single item category - render as direct button
                if (isSingleItem) {
                  return (
                    <Button
                      key={category.key}
                      variant="light"
                      size="sm"
                      startContent={<IconComponent className="w-4 h-4" />}
                      className={pathname === firstHref
                        ? 'bg-primary text-primary-foreground data-[hover=true]:bg-primary-600'
                        : 'text-default-700 hover:bg-default-200 dark:hover:bg-default-100 hover:text-default-900'}
                      onPress={() => {
                        if (firstHref) {
                          if (firstItem?.isExternal) {
                            window.open(firstHref, '_blank', 'noopener,noreferrer')
                          } else {
                            router.push(firstHref)
                          }
                        }
                      }}
                    >
                      {category.label}
                    </Button>
                  )
                }

                // Multiple items - render with dropdown
                return (
                  <div
                    key={category.key}
                    onMouseEnter={() => handleMouseEnter(category.key)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => {
                      if (firstHref) {
                        if (closeTimeoutRef.current) {
                          clearTimeout(closeTimeoutRef.current)
                          closeTimeoutRef.current = null
                        }
                        setOpenDropdown(null)
                        if (firstItem?.isExternal) {
                          window.open(firstHref, '_blank', 'noopener,noreferrer')
                        } else {
                          router.push(firstHref)
                        }
                      }
                    }}
                    className="cursor-pointer rounded-lg hover:bg-default-200 dark:hover:bg-default-100 transition-colors"
                  >
                    <Dropdown
                      isOpen={openDropdown === category.key}
                    >
                      <DropdownTrigger>
                        <Button
                          variant="light"
                          size="sm"
                          startContent={<IconComponent className="w-4 h-4" />}
                          endContent={<ChevronDown className="w-4 h-4" />}
                          className="text-default-700 hover:bg-default-100 hover:text-default-900 pointer-events-none"
                          as="div"
                        >
                          {category.label}
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu
                        aria-label={`${category.label} menu`}
                        onAction={(key) => {
                          if (closeTimeoutRef.current) {
                            clearTimeout(closeTimeoutRef.current)
                            closeTimeoutRef.current = null
                          }
                          setOpenDropdown(null)

                          const item = category.items.find(i => i.href === key)
                          if (item?.isExternal) {
                            window.open(key as string, '_blank', 'noopener,noreferrer')
                          } else {
                            router.push(key as string)
                          }
                        }}
                      >
                        {category.items.map((item) => (
                          <DropdownItem
                            key={item.href}
                            className={pathname === item.href ? 'bg-primary text-primary-foreground' : ''}
                          >
                            {item.label}
                          </DropdownItem>
                        ))}
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                )
              })}
            </div>

            {/* Mobile Menu Button */}
            <div className="md:hidden">
              <Dropdown
                isOpen={isMobileMenuOpen}
                onOpenChange={setIsMobileMenuOpen}
                placement="bottom-end"
              >
                <DropdownTrigger>
                  <Button
                    variant="light"
                    isIconOnly
                    aria-label="Toggle menu"
                  >
                    <Menu className="w-6 h-6" />
                  </Button>
                </DropdownTrigger>
                <DropdownMenu
                  aria-label="Navigation menu"
                  onAction={(key) => {
                    setIsMobileMenuOpen(false)
                    const href = key as string
                    // Check if it's an external link
                    if (href.startsWith('http://') || href.startsWith('https://')) {
                      window.open(href, '_blank', 'noopener,noreferrer')
                    } else {
                      router.push(href)
                    }
                  }}
                  className="w-full"
                  itemClasses={{
                    base: "gap-4",
                  }}
                >
                  {visibleMenuCategories.map((category) => {
                    const IconComponent = category.icon
                    return (
                      <DropdownSection
                        key={category.key}
                        showDivider
                      >
                        <DropdownItem
                          key={`${category.key}-header`}
                          isReadOnly
                          className="opacity-100 font-semibold cursor-default data-[hover=true]:bg-transparent"
                          startContent={<IconComponent className="w-5 h-5" />}
                        >
                          {category.label}
                        </DropdownItem>
                        {category.items.map((item) => (
                          <DropdownItem
                            key={item.href}
                            className={`${pathname === item.href ? 'bg-primary text-primary-foreground' : ''} pl-9`}
                          >
                            {item.label}
                          </DropdownItem>
                        )) as any}
                      </DropdownSection>
                    )
                  })}
                </DropdownMenu>
              </Dropdown>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitch />
            {isAuthenticatedValue ? (
              <>
                <Button
                  variant="light"
                  size="sm"
                  onPress={() => router.push('/profile')}
                  className="hidden sm:flex"
                >
                  {user?.nickname || user?.name}
                </Button>
                <Dropdown>
                  <DropdownTrigger>
                    <Button
                      variant="light"
                      size="sm"
                      isIconOnly
                      className="sm:hidden"
                      aria-label="User menu"
                    >
                      <User className="w-5 h-5" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu aria-label="User actions">
                    <DropdownItem key="profile" onPress={() => router.push('/profile')}>
                      {user?.nickname || user?.name}
                    </DropdownItem>
                    <DropdownItem key="logout" color="danger" onPress={handleLogout}>
                      退出登录
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
                <Button
                  color="danger"
                  variant="light"
                  size="sm"
                  onPress={handleLogout}
                  className="hidden sm:flex"
                >
                  退出登录
                </Button>
              </>
            ) : (
              <Button
                color="primary"
                variant="flat"
                size="sm"
                onPress={handleLoginClick}
              >
                登录
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}

export default memo(Navbar)
