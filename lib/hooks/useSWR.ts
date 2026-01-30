import useSWR from 'swr'
import { useAuthStore } from '@/lib/store/auth'

interface FetcherOptions {
  method?: string
  body?: unknown
  withAuth?: boolean
}

const fetcher = async (url: string, token: string | null, options?: FetcherOptions) => {
  const withAuth = options?.withAuth ?? true

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (withAuth && token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const config: RequestInit = {
    headers,
    method: options?.method || 'GET',
  }

  if (options?.body) {
    config.body = JSON.stringify(options.body)
  }

  const res = await fetch(url, config)

  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.') as Error & {
      info?: unknown
      status?: number
    }
    error.info = await res.json()
    error.status = res.status
    throw error
  }

  return res.json()
}

export function useAPI<T = unknown>(
  url: string | null,
  options?: FetcherOptions & { refreshInterval?: number; keepPreviousData?: boolean }
) {
  const token = useAuthStore((state) => state.token)
  const withAuth = options?.withAuth ?? true

  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(
    url ? [url, withAuth ? token : null, options] : null,
    ([url, token, options]: [string, string | null, FetcherOptions | undefined]) => fetcher(url, token, options),
    {
      refreshInterval: options?.refreshInterval,
      revalidateOnFocus: false,
      keepPreviousData: options?.keepPreviousData,
    }
  )

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
  }
}

export async function apiRequest<T = unknown>(
  url: string,
  options?: FetcherOptions
): Promise<T> {
  const withAuth = options?.withAuth ?? true
  const token = withAuth ? useAuthStore.getState().token : null
  return fetcher(url, token, options)
}
