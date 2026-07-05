'use client'

import { useEffect, useMemo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button, Modal, ModalBody, ModalContent, ModalFooter } from '@/lib/heroui-compat'
import { Download, Edit3, ExternalLink, Keyboard, Sparkles, X } from 'lucide-react'
import { useKeytaoIntroStore } from '@/lib/store/keytaoIntro'
import { KEYTAO_QQ_GROUP_URL } from '@/lib/constants/community'

const introCards = [
  {
    icon: Sparkles,
    title: '键道是什么',
    description: '把形码、音码和顶功输入揉成一套更顺手的中文输入方案，目标不是背更多，而是更快进入流畅状态。',
    accent: 'from-sky-500/20 via-cyan-400/10 to-transparent',
    hrefLabel: '查看键道文档',
    useDocsUrl: true,
  },
  {
    icon: Download,
    title: '安装从哪里开始',
    description: '先看安装页挑平台，再跟着文档部署 Rime 方案；装好之后马上能进练习页、词库页和加词流程。',
    accent: 'from-emerald-500/20 via-teal-400/10 to-transparent',
    href: '/install',
    hrefLabel: '查看安装引导',
  },
  {
    icon: Edit3,
    title: '加词怎么工作',
    description: '你提交词条后，系统会生成批次与提议，社区讨论、维护者审核，再同步回官方词库仓库。',
    accent: 'from-fuchsia-500/20 via-pink-400/10 to-transparent',
    href: '/',
    hrefLabel: '直接开始加词',
  },
]

export default function KeytaoIntroModal() {
  const pathname = usePathname()
  const isOpen = useKeytaoIntroStore((state) => state.isOpen)
  const hasSeenIntro = useKeytaoIntroStore((state) => state.hasSeenIntro)
  const hasHydrated = useKeytaoIntroStore((state) => state.hasHydrated)
  const hasAutoOpened = useKeytaoIntroStore((state) => state.hasAutoOpened)
  const openIntroModal = useKeytaoIntroStore((state) => state.openIntroModal)
  const closeIntroModal = useKeytaoIntroStore((state) => state.closeIntroModal)
  const acknowledgeIntroModal = useKeytaoIntroStore((state) => state.acknowledgeIntroModal)
  const markAutoOpened = useKeytaoIntroStore((state) => state.markAutoOpened)

  const docsUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'https://keytao-docs.vercel.app/'

    return window.location.host.includes('rea.ink')
      ? 'https://keytao-docs.rea.ink/'
      : 'https://keytao-docs.vercel.app/'
  }, [])

  useEffect(() => {
    if (pathname !== '/' || !hasHydrated || hasSeenIntro || hasAutoOpened) return
    markAutoOpened()
    openIntroModal()
  }, [hasAutoOpened, hasHydrated, hasSeenIntro, markAutoOpened, openIntroModal, pathname])

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeIntroModal}
      size="4xl"
      scrollBehavior="inside"
      backdrop="blur"
      isDismissable={false}
      hideCloseButton
      className="w-[min(calc(100vw-1rem),960px)] max-w-none"
    >
      <ModalContent className="mx-auto w-[min(calc(100vw-1rem),960px)] max-w-none max-h-[calc(100dvh-1rem)] overflow-hidden rounded-2xl border border-default-200 bg-content1 text-foreground shadow-[0_40px_120px_hsl(var(--shadow-color)/0.18)]">
        <div className="flex items-center justify-between border-b border-default-200 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="KeyTao logo"
              width={34}
              height={34}
              className="rounded-md"
            />
            <div className="leading-none">
              <p className="text-sm font-semibold text-foreground">键道</p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-normal text-default-500">KeyTao</p>
            </div>
          </div>
          <Button
            isIconOnly
            variant="light"
            className="h-9 w-9 text-default-500 hover:bg-content2 hover:text-foreground"
            aria-label="关闭键道介绍弹窗"
            onPress={acknowledgeIntroModal}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ModalBody className="max-h-[calc(100dvh-11rem)] overflow-y-auto px-4 py-5 sm:px-7 sm:py-7">
          <div className="grid gap-6 md:grid-cols-[1.12fr_0.88fr] md:items-center">
            <div className="min-w-0">
              <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-default-200 bg-content2 px-2.5 py-1 text-xs font-medium text-default-600">
                <Sparkles className="h-3.5 w-3.5" />
                初次见面
              </div>
              <h2 className="max-w-[14em] text-[clamp(1.85rem,3.2vw,3.1rem)] font-semibold leading-[1.04] tracking-normal text-foreground">
                键道，把输入和词库协作连成一条路径。
              </h2>
              <p className="mt-4 max-w-[34rem] text-sm leading-6 text-default-500 sm:text-base sm:leading-7">
                你可以先安装方案，再进入练习，最后参与加词。这里把文档、安装与词库协作串成同一套入口。
              </p>
            </div>
            <div className="relative flex min-h-52 items-center justify-center overflow-hidden rounded-xl border border-default-200 bg-content2/65">
              <div className="absolute inset-x-6 top-6 h-px bg-default-200" />
              <div className="absolute inset-y-6 left-6 w-px bg-default-200" />
              <div className="rounded-2xl border border-default-200 bg-content1 p-5 shadow-[0_18px_48px_hsl(var(--shadow-color)/0.08)]">
                <Image
                  src="/logo.png"
                  alt="KeyTao logo"
                  width={118}
                  height={118}
                  className="h-[92px] w-[92px] sm:h-[118px] sm:w-[118px]"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            {introCards.map((item) => {
              const Icon = item.icon
              const href = item.useDocsUrl ? docsUrl : item.href
              return (
                <div
                  key={item.title}
                  className="relative overflow-hidden rounded-xl border border-default-200 bg-content2/45 p-4"
                >
                  <div className="relative space-y-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-default-200 bg-content1 text-default-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold text-foreground sm:text-base">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-default-500">{item.description}</p>
                    </div>
                    {href && item.hrefLabel && (
                      <Button
                        as={Link}
                        href={href}
                        size="sm"
                        variant="light"
                        className="-ml-1 w-fit px-1 text-sm text-foreground"
                        target={item.useDocsUrl ? '_blank' : undefined}
                        rel={item.useDocsUrl ? 'noopener noreferrer' : undefined}
                        onPress={closeIntroModal}
                      >
                        {item.hrefLabel}
                        {item.useDocsUrl ? <ExternalLink className="h-3.5 w-3.5" /> : null}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </ModalBody>
        <ModalFooter className="flex flex-col items-stretch gap-3 border-t border-default-200 bg-content2/45 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:pb-4">
          <p className="text-xs leading-5 text-default-500 sm:max-w-xs">
            之后仍可从关于页随时重新打开。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              as={Link}
              href={KEYTAO_QQ_GROUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              variant="bordered"
              className="w-full border-default-200 bg-content1 text-foreground sm:w-auto"
              endContent={<ExternalLink className="h-3.5 w-3.5" />}
            >
              加入 QQ 群
            </Button>
            <Button
              as={Link}
              href="/practice"
              color="secondary"
              variant="flat"
              className="w-full bg-content1 text-foreground sm:w-auto"
              startContent={<Keyboard className="h-4 w-4" />}
              onPress={acknowledgeIntroModal}
            >
              在线练习
            </Button>
            <Button
              color="primary"
              className="w-full sm:w-auto"
              onPress={acknowledgeIntroModal}
            >
              开始探索
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
