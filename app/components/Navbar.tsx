'use client'

import { useEffect, useMemo, useCallback, memo, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Link, Drawer, DrawerContent, DrawerHeader, DrawerBody, Divider } from '@/lib/heroui-compat'
import { Menu, User, Database, Shield, ChevronDown, Edit, Download, BookOpen, Code, Coffee, Info, Keyboard } from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth'
import { useAPI } from '@/lib/hooks/useSWR'
import { useClientReady } from '@/lib/hooks/useClientReady'
import Logo from './Logo'
import ThemeSwitch from './ThemeSwitch'
import { SiGithub } from '@icons-pack/react-simple-icons'

function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isClientReady = useClientReady()

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
  const isAuthenticatedValue = isClientReady && !!user && !!token

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
        { label: '我的词库', href: '/user-dictionary' },
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
      key: 'practice',
      label: '练习',
      icon: Keyboard,
      items: [
        { label: '键道练习', href: '/practice' },
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
      key: 'developer',
      label: '开发者',
      icon: Code,
      items: [
        { label: 'API 文档', href: '/developer' },
      ]
    },
    {
      key: 'about',
      label: '关于',
      icon: Info,
      items: [
        { label: '关于本站', href: '/about' },
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
        { label: '赞助管理', href: '/admin/sponsors', requireRootAdmin: true },
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

  const isItemActive = useCallback((href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(`${href}/`)
  }, [pathname])

  const isCategoryActive = useCallback((category: MenuCategory) => {
    return category.items.some((item) => !item.isExternal && isItemActive(item.href))
  }, [isItemActive])

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

  const navItemClass = (active: boolean) => [
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium leading-none tracking-[-0.01em] whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]',
    active
      ? 'bg-foreground text-background shadow-[0_1px_1px_hsl(var(--shadow-color)/0.12)]'
      : 'text-default-600 hover:bg-content1 hover:text-foreground'
  ].join(' ')

  return (
    <>
      <Drawer
        isOpen={isMobileMenuOpen}
        onOpenChange={setIsMobileMenuOpen}
        placement="left"
        size="xs"
      >
        <DrawerContent>
          {(onClose) => (
            <>
              <DrawerHeader className="border-b border-divider">
                <Logo />
              </DrawerHeader>
              <DrawerBody className="px-3 py-4 gap-0">
                {visibleMenuCategories.map((category, index) => {
                  const IconComponent = category.icon
                  return (
                    <div key={category.key}>
                      {index > 0 && <Divider className="my-3" />}
                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-default-400 uppercase tracking-wider">
                        <IconComponent className="w-3.5 h-3.5" />
                        {category.label}
                      </div>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {category.items.map((item) => (
                          <Button
                            key={item.href}
                            variant={pathname === item.href ? 'flat' : 'light'}
                            color={pathname === item.href ? 'primary' : 'default'}
                            className="w-full justify-start pl-7 font-normal h-9"
                            size="sm"
                            onPress={() => {
                              onClose()
                              if (item.isExternal) {
                                window.open(item.href, '_blank', 'noopener,noreferrer')
                              } else {
                                router.push(item.href)
                              }
                            }}
                          >
                            {item.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </DrawerBody>
            </>
          )}
        </DrawerContent>
      </Drawer>
      <nav className="sticky top-0 z-60 border-b border-default-200/70 bg-background/82 backdrop-blur-xl">
        <div className="app-container">
          <div className="flex h-16 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 nav:gap-4">
              <Logo size={32} />
              {/* Desktop Navigation */}
              <div className="hidden nav:flex h-10 items-center gap-0.5 rounded-xl border border-default-200/80 bg-content2/65 p-1 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--surface)_70%,transparent)]">
                {visibleMenuCategories.map((category) => {
                  const IconComponent = category.icon
                  const firstItem = category.items[0]
                  const firstHref = firstItem?.href
                  const isSingleItem = category.items.length === 1
                  const categoryActive = isCategoryActive(category)

                  // Single item category - render as direct button
                  if (isSingleItem) {
                    return (
                      <button
                        key={category.key}
                        type="button"
                        className={navItemClass(categoryActive)}
                        onClick={() => {
                          if (firstHref) {
                            if (firstItem?.isExternal) {
                              window.open(firstHref, '_blank', 'noopener,noreferrer')
                            } else {
                              router.push(firstHref)
                            }
                          }
                        }}
                      >
                        <IconComponent className="h-3.5 w-3.5 shrink-0 opacity-75" />
                        {category.label}
                      </button>
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
                      className="cursor-pointer rounded-md"
                    >
                      <Dropdown
                        isOpen={openDropdown === category.key}
                      >
                        <DropdownTrigger>
                          <button
                            type="button"
                            className={navItemClass(categoryActive)}
                          >
                            <IconComponent className="h-3.5 w-3.5 shrink-0 opacity-75" />
                            {category.label}
                            <ChevronDown className="h-3 w-3 shrink-0 opacity-55" />
                          </button>
                        </DropdownTrigger>
                        <DropdownMenu
                          aria-label={`${category.label} menu`}
                          className="min-w-36 rounded-xl border border-default-200 bg-content1 p-1 shadow-[0_18px_48px_hsl(var(--shadow-color)/0.12)]"
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
                              className={isItemActive(item.href) ? 'rounded-lg bg-content2 text-foreground' : 'rounded-lg text-default-700'}
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
              <div className="nav:hidden">
                <Button
                  variant="light"
                  isIconOnly
                  aria-label="Toggle menu"
                  onPress={() => setIsMobileMenuOpen(true)}
                  className="h-9 w-9"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <div className="hidden md:block">
                <Button
                  variant="flat"
                  size="sm"
                  startContent={<Coffee className="w-4 h-4" />}
                  aria-label="赞助键道开发"
                  as={Link}
                  href="/sponsor"
                  className="h-9 border border-default-200 bg-content1 px-3 text-default-700 hover:bg-content2"
                >
                  赞助
                </Button>
              </div>
              <div className="md:hidden">
                <Button
                  variant="flat"
                  size="sm"
                  isIconOnly
                  aria-label="赞助键道开发"
                  as={Link}
                  href="/sponsor"
                  className="h-9 w-9 border border-default-200 bg-content1 text-default-700"
                >
                  <Coffee className="w-5 h-5" />
                </Button>
              </div>
              <Button
                variant="light"
                size="sm"
                isIconOnly
                aria-label="GitHub"
                as={Link}
                href="https://github.com/xkinput/KeyTao"
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 w-9 text-default-700 hover:bg-content2"
              >
                <SiGithub className="w-5 h-5" />
              </Button>
              <ThemeSwitch />
              {isAuthenticatedValue ? (
                <>
                  <div className="hidden sm:block">
                    <Button
                      variant="light"
                      size="sm"
                      onPress={() => router.push('/profile')}
                      className="h-9 max-w-36 px-3"
                    >
                      <span className="truncate">{user?.nickname || user?.name}</span>
                    </Button>
                  </div>
                  <div className="sm:hidden">
                    <Dropdown>
                      <DropdownTrigger>
                        <Button
                          variant="light"
                          size="sm"
                          isIconOnly
                          aria-label="User menu"
                        >
                          <User className="w-5 h-5" />
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu aria-label="User actions">
                        <DropdownItem key="profile" onPress={() => router.push('/profile')}>
                          {user?.nickname || user?.name}
                        </DropdownItem>
                        <DropdownItem key="logout" onPress={handleLogout}>
                          退出登录
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                  <div className="hidden sm:block">
                    <Button
                      variant="light"
                      size="sm"
                      onPress={handleLogout}
                      className="h-9 px-3"
                    >
                      退出登录
                    </Button>
                  </div>
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
    </>
  )
}

export default memo(Navbar)
