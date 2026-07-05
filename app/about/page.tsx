'use client'

import { Button } from '@/lib/heroui-compat'
import { ExternalLink, BookOpen, Bot, Users, Database, Edit3, GitPullRequest, MessageSquare, Sparkles } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useKeytaoIntroStore } from '@/lib/store/keytaoIntro'
import { KEYTAO_QQ_GROUP_URL } from '@/lib/constants/community'
import { SiGithub as Github } from '@icons-pack/react-simple-icons'

const links = [
  {
    icon: Github,
    label: 'KeyTao 键道词库',
    sub: 'xkinput / KeyTao',
    href: 'https://github.com/xkinput/KeyTao',
    color: 'text-default-700',
    bg: 'bg-default-100',
  },
  {
    icon: Github,
    label: '本站源码',
    sub: 'xkinput / keytao-next',
    href: 'https://github.com/xkinput/keytao-next',
    color: 'text-default-700',
    bg: 'bg-default-100',
  },
  {
    icon: Bot,
    label: '键道 QQ/TG 机器人',
    sub: 'xkinput / keytao-bot',
    href: 'https://github.com/xkinput/keytao-bot',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
  },
  {
    icon: Users,
    label: 'xkinput 开源组织',
    sub: 'github.com/xkinput',
    href: 'https://github.com/xkinput',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
  },
  {
    icon: BookOpen,
    label: '键道使用文档',
    sub: 'keytao-docs.vercel.app',
    href: 'https://keytao-docs.vercel.app/',
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-900/20',
  },
  {
    icon: MessageSquare,
    label: '加入键道 QQ 群',
    sub: 'qm.qq.com/q/uNFITZVL4A',
    href: KEYTAO_QQ_GROUP_URL,
    color: 'text-cyan-600 dark:text-cyan-400',
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
  },
]

const features = [
  {
    icon: Edit3,
    title: '提交新词',
    desc: '任何用户均可在线提交想加入词库的词条，审核通过后同步至官方词库。',
  },
  {
    icon: MessageSquare,
    title: '词条讨论',
    desc: '通过 Issues 对已有词条发起讨论，报告错误编码或提出改进意见。',
  },
  {
    icon: GitPullRequest,
    title: '修改提议',
    desc: '通过 Pull Requests 对词条内容提出修改，由维护者审核合并。',
  },
  {
    icon: Database,
    title: '词库管理',
    desc: '浏览完整词库、搜索词条、查看编码，支持管理员批量审核与 GitHub 同步。',
  },
]

export default function AboutPage() {
  const openIntroModal = useKeytaoIntroStore((state) => state.openIntroModal)

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-10">

        {/* Hero */}
        <div className="flex flex-col items-center gap-4 text-center">
          <Image
            src="/logo.png"
            alt="KeyTao Logo"
            width={72}
            height={72}
            className="rounded-2xl"
          />
          <div>
            <h1 className="text-3xl font-bold text-foreground">KeyTao 键道词库管理系统</h1>
            <p className="mt-1 text-default-400 text-sm">keytao-next · xkinput 开源项目</p>
          </div>
          <p className="text-default-600 text-base leading-relaxed max-w-lg">
            本站是 <strong>KeyTao 键道</strong> 开源输入方案的词库协作平台。
            键道（星空键道6）是一套面向中文用户的高效形音输入方案，词库由社区共同维护并托管在 GitHub。
            本网站让任何人都可以在线浏览词库、提交新词、参与讨论、或提出修改，
            所有变更经过人工审核后自动同步至官方词库仓库。
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <Button
              variant="flat"
              color="secondary"
              startContent={<Sparkles className="w-4 h-4" />}
              onPress={openIntroModal}
            >
              查看键道介绍弹窗
            </Button>
            <Button
              as={Link}
              href="https://keytao-docs.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              variant="light"
              startContent={<BookOpen className="w-4 h-4" />}
            >
              直接打开文档
            </Button>
          </div>
        </div>

        {/* What is KeyTao */}
        <section className="rounded-2xl border border-default-200 bg-content1 p-6 flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">什么是键道？</h2>
          <p className="text-sm text-default-600 leading-relaxed">
            <strong>星空键道6</strong>（KeyTao）是一种将「形码」与「音码」融合的汉字输入方案，
            以极少的键位记忆量实现极高的单字覆盖与词语连打效率。
            方案本体、词库、安装器、机器人均以开源协议发布，任何人可免费使用和贡献。
          </p>
          <p className="text-sm text-default-600 leading-relaxed">
            词库是键道输入体验的核心。本站提供一个结构化的协作流程：
            用户提词 → 社区讨论 → 管理员审核 → 自动推送至 GitHub 词库仓库，
            保证词库持续扩充且质量可控。
          </p>
        </section>

        {/* Features */}
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-foreground">本站功能</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {features.map(f => {
              const Icon = f.icon
              return (
                <div key={f.title} className="rounded-xl border border-default-200 bg-content1 p-4 flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{f.title}</p>
                    <p className="text-xs text-default-400 mt-0.5 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Links */}
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-foreground">相关链接</h2>
          <div className="flex flex-col gap-2">
            {links.map(l => {
              const Icon = l.icon
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-default-200 bg-content1 px-4 py-3 hover:bg-default-50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${l.bg}`}>
                      <Icon className={`w-4 h-4 ${l.color}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{l.label}</p>
                      <p className="text-xs text-default-400">{l.sub}</p>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-default-300 group-hover:text-default-500 transition-colors shrink-0" />
                </Link>
              )
            })}
          </div>
        </section>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            as={Link}
            href="/"
            color="primary"
            variant="flat"
          >
            开始提词
          </Button>
          <Button
            as={Link}
            href="https://github.com/xkinput/KeyTao"
            target="_blank"
            rel="noopener noreferrer"
            variant="bordered"
            startContent={<Github className="w-4 h-4" />}
          >
            查看词库仓库
          </Button>
        </div>

        <p className="text-xs text-default-400 text-center">
          KeyTao 键道 · 由 xkinput 社区维护 · 完全开源免费
        </p>
      </div>
    </main>
  )
}
