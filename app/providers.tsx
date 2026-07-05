'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { Toaster } from 'react-hot-toast'
import { SWRConfig } from 'swr'
import GlobalFeedback from '@/app/components/GlobalFeedback'

export function Providers({ children }: { children: React.ReactNode }) {
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
      <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
        <GlobalFeedback />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              background: 'var(--surface)',
              color: 'var(--foreground)',
              border: '1px solid var(--separator)',
            },
            success: {
              iconTheme: {
                primary: 'var(--success)',
                secondary: 'var(--success-foreground)',
              },
            },
            error: {
              iconTheme: {
                primary: 'var(--danger)',
                secondary: 'var(--danger-foreground)',
              },
            },
          }}
        />
      </NextThemesProvider>
    </SWRConfig>
  )
}
