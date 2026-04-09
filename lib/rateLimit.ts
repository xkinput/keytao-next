// In-memory rate limiter: 2 requests per second per API key (sliding window)
const requestTimestamps = new Map<string, number[]>()

const WINDOW_MS = 1000
const MAX_REQUESTS = 2

export function checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const timestamps = (requestTimestamps.get(key) ?? []).filter(t => now - t < WINDOW_MS)

  if (timestamps.length >= MAX_REQUESTS) {
    const retryAfterMs = WINDOW_MS - (now - timestamps[0])
    return { allowed: false, retryAfterMs }
  }

  timestamps.push(now)
  requestTimestamps.set(key, timestamps)
  return { allowed: true, retryAfterMs: 0 }
}
