import { useMemo } from 'react'
import useSWR, { type SWRConfiguration } from 'swr'
import { useAuthStore } from '@/lib/store/auth'

interface FetcherOptions {
  method?: string
  body?: unknown
  withAuth?: boolean
  signal?: AbortSignal
}

async function readOptionalJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
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
    signal: options?.signal,
  }

  if (options?.body) {
    config.body = JSON.stringify(options.body)
  }

  let res = await fetch(url, config)

  if (res.status === 401 && withAuth && token) {
    const refreshRes = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers,
      signal: config.signal,
    })

    if (refreshRes.ok) {
      const refreshData = await readOptionalJson<{ token?: string }>(refreshRes)
      const newToken = refreshData?.token
      if (typeof newToken === 'string' && newToken) {
        if (useAuthStore.getState().token === token) {
          useAuthStore.setState({ token: newToken, _adminChecked: false })
        }
        res = await fetch(url, { ...config, headers: { ...headers, Authorization: `Bearer ${newToken}` } })
      }
    }
  }

  if (!res.ok) {
    const errorData = await readOptionalJson<{ error?: string }>(res)
    const error = new Error(errorData?.error || 'An error occurred while fetching the data.') as Error & {
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
  options?: FetcherOptions & Pick<SWRConfiguration,
    'refreshInterval' | 'keepPreviousData' | 'revalidateOnFocus' | 'revalidateOnReconnect'>
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
      revalidateOnFocus: options?.revalidateOnFocus ?? true,
      revalidateOnReconnect: options?.revalidateOnReconnect ?? true,
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
