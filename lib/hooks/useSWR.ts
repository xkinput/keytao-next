import { useMemo } from 'react'
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

  if (res.status === 401 && withAuth && token) {
    // Try to refresh token once
    try {
      const refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      if (refreshRes.ok) {
        const refreshData = await refreshRes.json() as { token: string }
        const newToken = refreshData.token
        if (newToken) {
          // update local store token
          useAuthStore.getState().setAuth(newToken, useAuthStore.getState().user as any)

          // retry original request with new token
          if (!config.headers) config.headers = {}
          // ensure headers typed as Record to set Authorization
          const hdrs = config.headers as Record<string, string>
          hdrs['Authorization'] = `Bearer ${newToken}`
          config.headers = hdrs as HeadersInit
          const retryRes = await fetch(url, config)
          if (!retryRes.ok) {
            const errorData = await retryRes.json() as { error?: string }
            const error = new Error(errorData.error || 'An error occurred while fetching the data.') as Error & {
              info?: unknown
              status?: number
            }
            error.info = errorData
            error.status = retryRes.status
            throw error
          }
          return retryRes.json()
        }
      }
    } catch {
      // ignore refresh errors and fall through to throw original error
    }
  }

  if (!res.ok) {
    const errorData = await res.json() as { error?: string }
    const error = new Error(errorData.error || 'An error occurred while fetching the data.') as Error & {
      info?: unknown
      status?: number
    }
    error.info = errorData
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

  // Create stable key without options object
  const key = useMemo(() => {
    if (!url) return null
    return withAuth ? [url, token] : [url, null]
  }, [url, withAuth, token])

  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(
    key,
    ([url, token]: [string, string | null]) => fetcher(url, token, options),
    {
      refreshInterval: options?.refreshInterval ?? 0,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      revalidateIfStale: true,
      dedupingInterval: 2000,
      keepPreviousData: options?.keepPreviousData ?? true,
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

export async function apiDownload(
  url: string,
  options?: FetcherOptions
): Promise<Response> {
  const withAuth = options?.withAuth ?? true
  const token = withAuth ? useAuthStore.getState().token : null

  const headers: HeadersInit = {}

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

  const response = await fetch(url, config)

  if (!response.ok) {
    const errorData = await response.json() as { error?: string }
    const error = new Error(errorData.error || 'Download failed') as Error & {
      info?: unknown
      status?: number
    }
    error.info = errorData
    error.status = response.status
    throw error
  }

  return response
}
