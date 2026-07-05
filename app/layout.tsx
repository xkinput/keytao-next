import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { Providers } from './providers'
import Navbar from '@/app/components/Navbar'
import ChatWidget from '@/app/components/ChatWidget'
import KeytaoIntroModal from '@/app/components/KeytaoIntroModal'
import MotionEffects from '@/app/components/MotionEffects'

const APP_NAME = 'KeyTao'
const APP_TITLE = 'KeyTao 星空键道6词库管理系统'
const APP_DESCRIPTION = '键道输入法, 星空键道, 键道6词库管理系统'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_TITLE,
    template: '%s | KeyTao',
  },
  description: APP_DESCRIPTION,
  keywords: ['键道', '键道6', '星空键道', '输入法', '词库管理', '开源', '免费'],
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: APP_TITLE,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    shortcut: ['/favicon.ico'],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: 'summary',
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
}

export const viewport: Viewport = {
  themeColor: '#111318',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Cubism 2 runtime must be evaluated before pixi-live2d-display/cubism2 */}
        <Script
          src="https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js"
          strategy="beforeInteractive"
        />
        <Providers>
          <MotionEffects />
          <Navbar />
          {children}
          <KeytaoIntroModal />
          <ChatWidget />
        </Providers>
      </body>
    </html>
  )
}
