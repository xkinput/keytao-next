'use client'

import { HeroUIProvider } from '@heroui/react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { useRouter } from 'next/navigation'
import { Toaster } from 'react-hot-toast'
import { SWRConfig } from 'swr'
import GlobalFeedback from '@/app/components/GlobalFeedback'

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <SWRConfig
      value={{
        dedupingInterval: 2000,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        revalidateIfStale: true,
        shouldRetryOnError: false,
      }}
    >
      <HeroUIProvider navigate={router.push}>
        <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <GlobalFeedback />
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3000,
              style: {
                background: 'hsl(var(--heroui-content1))',
                color: 'hsl(var(--heroui-foreground))',
                border: '1px solid hsl(var(--heroui-divider))',
              },
              success: {
                iconTheme: {
                  primary: 'hsl(var(--heroui-success))',
                  secondary: 'hsl(var(--heroui-success-foreground))',
                },
              },
              error: {
                iconTheme: {
                  primary: 'hsl(var(--heroui-danger))',
                  secondary: 'hsl(var(--heroui-danger-foreground))',
                },
              },
            }}
          />
        </NextThemesProvider>
      </HeroUIProvider>
    </SWRConfig>
  )
}
