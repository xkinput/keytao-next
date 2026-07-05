'use client'

import { useEffect, useMemo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button, Modal, ModalBody, ModalContent, ModalFooter } from '@/lib/heroui-compat'
import { BookOpen, Download, Edit3, ExternalLink, Keyboard, Sparkles, X } from 'lucide-react'
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
      classNames={{
        base: 'border border-primary/20 bg-[#0c1018] text-white shadow-[0_40px_120px_rgba(59,130,246,0.18)]',
      }}
    >
      <ModalContent className="mx-0 h-[100dvh] max-h-[100dvh] rounded-none sm:mx-4 sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl">
        <div className="relative grid h-20 grid-cols-[1fr_auto_1fr] items-center gap-2 overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(168,85,247,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.2),_transparent_34%),linear-gradient(135deg,_#101828,_#16213a)] px-4 sm:hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute h-24 w-24 rounded-full bg-sky-400/20 blur-3xl" />
          <div className="absolute h-28 w-28 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="relative z-10 flex items-center">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-cyan-200/90">
              <Sparkles className="h-3.5 w-3.5" />
              初次见面
            </div>
          </div>
          <div className="relative z-10 rounded-[22px] border border-white/10 bg-white/8 p-2.5 backdrop-blur-xl">
            <Image
              src="/logo.png"
              alt="KeyTao logo"
              width={72}
              height={72}
              className="h-[52px] w-[52px] drop-shadow-[0_0_22px_rgba(96,165,250,0.55)]"
            />
          </div>
          <Button
            isIconOnly
            variant="light"
            radius="full"
            className="relative z-10 ml-auto h-9 w-9 min-w-9 border border-white/10 bg-white/8 text-white/75 backdrop-blur hover:bg-white/14 hover:text-white"
            aria-label="关闭键道介绍弹窗"
            onPress={acknowledgeIntroModal}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ModalBody className="overflow-y-auto px-0 py-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.18),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(217,70,239,0.16),_transparent_28%),linear-gradient(135deg,_#0b1220,_#111827_58%,_#120f1f)] px-4 py-4 sm:hidden">
            <div className="space-y-2.5">
              <h2 className="text-[1.7rem] font-semibold leading-tight tracking-tight text-white">
                键道不是一堆规则，
                <span className="bg-gradient-to-r from-sky-300 via-fuchsia-300 to-cyan-200 bg-clip-text text-transparent">而是一条从输入到词库协作的完整路径</span>
              </h2>
              <p className="text-sm leading-6 text-white/72">
                你可以先装方案、再上手练习、然后开始加词。这里把文档、安装与词库协作流程串成同一套入口，避免第一次接触键道时四处找信息。
              </p>
            </div>
          </div>

          <div className="relative hidden overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.28),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(217,70,239,0.24),_transparent_28%),linear-gradient(135deg,_#0b1220,_#111827_58%,_#120f1f)] px-4 py-5 pr-14 sm:block sm:rounded-t-3xl sm:px-8 sm:py-8 sm:pr-16">
            <Button
              isIconOnly
              variant="light"
              radius="full"
              className="absolute right-3 top-3 z-10 hidden h-9 w-9 min-w-9 border border-white/10 bg-white/8 text-white/75 backdrop-blur hover:bg-white/14 hover:text-white sm:flex sm:right-4 sm:top-4"
              aria-label="关闭键道介绍弹窗"
              onPress={acknowledgeIntroModal}
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="absolute -right-10 top-3 h-28 w-28 rounded-full bg-fuchsia-500/20 blur-3xl sm:-right-12 sm:top-6 sm:h-36 sm:w-36" />
            <div className="absolute left-2 top-4 h-20 w-20 rounded-full bg-cyan-400/20 blur-3xl sm:left-8 sm:top-10 sm:h-24 sm:w-24" />
            <div className="relative flex flex-col items-center gap-5 text-center lg:flex-row lg:items-center lg:justify-between lg:text-left">
              <div className="order-1 relative hidden items-center justify-center sm:flex lg:order-2 lg:min-w-64">
                <div className="absolute h-28 w-28 rounded-full bg-sky-400/20 blur-3xl sm:h-40 sm:w-40" />
                <div className="absolute h-32 w-32 rounded-full bg-fuchsia-500/20 blur-3xl sm:h-44 sm:w-44" />
                <div className="relative rounded-[24px] border border-white/10 bg-white/5 p-3 backdrop-blur-xl sm:rounded-[28px] sm:p-5">
                  <Image
                    src="/logo.png"
                    alt="KeyTao logo"
                    width={132}
                    height={132}
                    className="h-[88px] w-[88px] drop-shadow-[0_0_28px_rgba(96,165,250,0.55)] sm:h-[132px] sm:w-[132px]"
                  />
                </div>
              </div>

              <div className="order-2 max-w-2xl space-y-3 sm:space-y-4 lg:order-1">
                <div className="hidden w-fit items-center gap-2 self-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-cyan-200/90 sm:inline-flex sm:text-xs lg:self-start">
                  <Sparkles className="h-3.5 w-3.5" />
                  初次见面
                </div>
                <div className="space-y-2.5 sm:space-y-3">
                  <h2 className="text-2xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
                    键道不是一堆规则，
                    <span className="bg-gradient-to-r from-sky-300 via-fuchsia-300 to-cyan-200 bg-clip-text text-transparent">而是一条从输入到词库协作的完整路径</span>
                  </h2>
                  <p className="max-w-xl text-sm leading-6 text-white/70 sm:text-base sm:leading-7">
                    你可以先装方案、再上手练习、然后开始加词。这里把文档、安装与词库协作流程串成同一套入口，避免第一次接触键道时四处找信息。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 px-4 py-4 sm:px-8 sm:py-7 lg:grid-cols-3 lg:gap-4">
            {introCards.map((item) => {
              const Icon = item.icon
              const href = item.useDocsUrl ? docsUrl : item.href
              return (
                <div
                  key={item.title}
                  className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/4.5 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                >
                  <div className={`absolute inset-0 bg-linear-to-br ${item.accent}`} />
                  <div className="relative space-y-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-sky-200 sm:h-10 sm:w-10 sm:rounded-2xl">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold text-white sm:text-base">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-white/65">{item.description}</p>
                    </div>
                    {href && item.hrefLabel && (
                      <Button
                        as={Link}
                        href={href}
                        size="sm"
                        variant="light"
                        className="-ml-1 w-fit px-1 text-sm text-cyan-200"
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
        <ModalFooter className="flex flex-col items-stretch gap-3 border-t border-white/10 bg-white/3 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:pb-4">
          <p className="text-xs leading-5 text-white/55 sm:max-w-xs">
            之后仍可从关于页随时重新打开。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              as={Link}
              href={KEYTAO_QQ_GROUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              variant="bordered"
              className="w-full border-cyan-300/25 bg-cyan-400/8 text-cyan-50 sm:w-auto"
              endContent={<ExternalLink className="h-3.5 w-3.5" />}
            >
              加入 QQ 群
            </Button>
            <Button
              as={Link}
              href="/practice"
              color="secondary"
              variant="flat"
              className="w-full bg-white/8 text-white sm:w-auto"
              startContent={<Keyboard className="h-4 w-4" />}
              onPress={acknowledgeIntroModal}
            >
              在线练习
            </Button>
            <Button
              color="primary"
              className="w-full border border-cyan-500/30 bg-cyan-100 text-slate-950 shadow-lg shadow-cyan-950/20 transition-colors hover:bg-white sm:w-auto"
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