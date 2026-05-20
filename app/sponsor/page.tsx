'use client'

import Image from 'next/image'
import { Button, Link, Chip, Spinner } from '@heroui/react'
import { Coffee, Github, Heart, ExternalLink } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'

interface SponsorItem {
  id: number
  displayName: string
  amount: number
  message: string | null
  channel: string
  createdAt: string
}

const channelLabel: Record<string, { label: string; color: 'success' | 'primary' | 'default' }> = {
  wechat: { label: '微信', color: 'success' },
  alipay: { label: '支付宝', color: 'primary' },
  other: { label: '其他', color: 'default' },
}

const projects = [
  {
    name: 'keytao-next',
    desc: '键道官方网站 · 词库管理 · 用户提词平台',
    href: 'https://github.com/xkinput/keytao-next',
  },
  {
    name: 'keytao-app',
    desc: 'KeyTao键道App · 跨平台桌面客户端输入法/安装工具',
    href: 'https://github.com/xkinput/keytao-app',
  },
  {
    name: 'keytao-bot',
    desc: '键道 QQ 机器人 · 自动化查词 / 播报',
    href: 'https://github.com/xkinput/keytao-bot',
  },
]

export default function SponsorPage() {
  const { data: sponsors, isLoading } = useAPI<SponsorItem[]>('/api/sponsors')

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col items-center gap-6">

        {/* Header */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center">
            <Coffee className="w-8 h-8 text-pink-500" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">赞助键道项目开发</h1>
          <p className="text-default-500 text-base leading-relaxed max-w-md">
            键道是一款完全由社区驱动的汉字输入方案，所有工具均开源、免费。
            你的赞助将用于域名、服务器、AI 接口等基础设施的持续投入，以及开发者的日常维护。
          </p>
        </div>

        {/* Covered costs */}
        <div className="w-full rounded-2xl border border-default-200 bg-content1 p-6 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-default-500 uppercase tracking-wide">赞助将用于</h2>
          <ul className="grid grid-cols-2 gap-2 text-sm text-default-700">
            <li className="flex items-start gap-2"><Heart className="w-4 h-4 mt-0.5 text-pink-400 shrink-0" />喵喵 AI · QQ / TG 机器人运营</li>
            <li className="flex items-start gap-2"><Heart className="w-4 h-4 mt-0.5 text-pink-400 shrink-0" />键道加词词库管理系统（本网站）</li>
            <li className="flex items-start gap-2"><Heart className="w-4 h-4 mt-0.5 text-pink-400 shrink-0" />KeyTao键道App · 跨平台桌面客户端输入法/安装工具 更新维护</li>
            <li className="flex items-start gap-2"><Heart className="w-4 h-4 mt-0.5 text-pink-400 shrink-0" />以及未来发布在 xkinput 组织下的所有项目</li>
          </ul>
        </div>

        {/* QR Codes */}
        <div className="w-full flex flex-col sm:flex-row gap-6 justify-center">
          {/* WeChat */}
          <div className="flex-1 flex flex-col items-center gap-3 rounded-2xl border border-default-200 bg-content1 p-6">
            <Chip color="success" variant="flat" size="sm">微信支付</Chip>
            <div className="relative w-44 h-44 rounded-xl overflow-hidden border border-default-100">
              <Image
                src="/wechat.jpg"
                alt="微信赞赏码"
                fill
                className="object-contain"
              />
            </div>
            <p className="text-xs text-default-400 text-center">
              扫码后请在备注中填写<br />
              <span className="font-semibold text-default-600">键道项目赞助+留言和用户名</span><br />
              <span className="font-semibold text-default-600">（您的名字与留言将显示在列表中）</span>
            </p>
          </div>

          {/* Alipay */}
          <div className="flex-1 flex flex-col items-center gap-3 rounded-2xl border border-default-200 bg-content1 p-6">
            <Chip color="primary" variant="flat" size="sm">支付宝</Chip>
            <div className="relative w-44 h-44 rounded-xl overflow-hidden border border-default-100">
              <Image
                src="/alipay.jpg"
                alt="支付宝收款码"
                fill
                className="object-contain"
              />
            </div>
            <p className="text-xs text-default-400 text-center">
              扫码后请在备注中填写<br />
              <span className="font-semibold text-default-600">键道项目赞助+留言和用户名</span><br />
              <span className="font-semibold text-default-600">（您的名字与留言将显示在列表中）</span>
            </p>
          </div>
        </div>

        {/* Sponsors list */}
        <div className="w-full flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-default-500 uppercase tracking-wide flex items-center gap-2">
            <Heart className="w-4 h-4 text-pink-400" />
            赞助者名单
          </h2>
          <p className="text-xs text-default-400 flex items-center gap-1">
            名单将在 24 小时内更新，由人工审核后添加至列表中
          </p>
          {isLoading ? (
            <div className="flex justify-center py-8"><Spinner size="sm" /></div>
          ) : !sponsors || sponsors.length === 0 ? (
            <p className="text-sm text-default-400 text-center py-6">暂无赞助者，成为第一位支持者 ☕</p>
          ) : (
            <div className="w-full flex flex-col divide-y divide-default-100 rounded-2xl border border-default-200 bg-content1 overflow-hidden">
              {sponsors.map(s => {
                const ch = channelLabel[s.channel] ?? channelLabel.other
                return (
                  <div key={s.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-full bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Coffee className="w-4 h-4 text-pink-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-foreground">{s.displayName}</span>
                        <Chip size="sm" color={ch.color} variant="flat" className="h-4 text-[10px]">{ch.label}</Chip>
                        <span className="text-xs text-pink-500 font-semibold">¥{s.amount}</span>
                      </div>
                      {s.message && (
                        <p className="text-xs text-default-400 mt-0.5 truncate">{s.message}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-default-300 shrink-0 mt-1">
                      {new Date(s.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Open source projects */}
        <div className="w-full flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-default-500 uppercase tracking-wide">开源项目</h2>
          {projects.map(p => (
            <Link
              key={p.name}
              href={p.href}
              isExternal
              className="flex items-center justify-between rounded-xl border border-default-200 bg-content1 px-4 py-3 hover:bg-default-100 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Github className="w-4 h-4 text-default-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">xkinput / {p.name}</p>
                  <p className="text-xs text-default-400">{p.desc}</p>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-default-300 group-hover:text-default-500 transition-colors shrink-0" />
            </Link>
          ))}
          <Button
            as={Link}
            href="https://github.com/xkinput"
            isExternal
            variant="bordered"
            size="sm"
            startContent={<Github className="w-4 h-4" />}
            className="mt-1 self-start"
          >
            查看 xkinput 组织
          </Button>
        </div>

        <p className="text-xs text-default-400 text-center">感谢每一位支持者，是你们让键道持续成长 ☕</p>
      </div>
    </main>
  )
}
