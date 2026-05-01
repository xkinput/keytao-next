import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import Navbar from "@/app/components/Navbar";
import ChatWidget from "@/app/components/ChatWidget";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KeyTao 星空键道6词库管理系统",
  description: "键道输入法,星空键道,键道6词库管理系统",
  keywords: ["键道", "键道6", "星空键道", "输入法", "词库管理", "开源", "免费"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      {/* Cubism 2 runtime must be evaluated before pixi-live2d-display/cubism2 */}
      <Script
        src="https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js"
        strategy="beforeInteractive"
      />
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <Navbar />
          {children}
          <ChatWidget />
        </Providers>
      </body>
    </html>
  );
}
