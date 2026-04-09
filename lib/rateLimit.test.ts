import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkRateLimit } from './rateLimit'

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows the first request', () => {
    const result = checkRateLimit('key-1')
    expect(result.allowed).toBe(true)
    expect(result.retryAfterMs).toBe(0)
  })

  it('allows 2 requests within the same second', () => {
    expect(checkRateLimit('key-2').allowed).toBe(true)
    expect(checkRateLimit('key-2').allowed).toBe(true)
  })

  it('blocks the 3rd request within the same second', () => {
    checkRateLimit('key-3')
    checkRateLimit('key-3')
    const result = checkRateLimit('key-3')
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('allows requests again after the window expires', () => {
    checkRateLimit('key-4')
    checkRateLimit('key-4')
    expect(checkRateLimit('key-4').allowed).toBe(false)

    vi.advanceTimersByTime(1000)

    expect(checkRateLimit('key-4').allowed).toBe(true)
  })

  it('retryAfterMs reflects time until oldest request expires', () => {
    vi.setSystemTime(0)
    checkRateLimit('key-5')
    vi.advanceTimersByTime(300)
    checkRateLimit('key-5')

    // window started at t=0, so oldest expires at t=1000, now is t=300
    const result = checkRateLimit('key-5')
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeCloseTo(700, -1)
  })

  it('isolates state between different keys', () => {
    checkRateLimit('key-a')
    checkRateLimit('key-a')
    checkRateLimit('key-a') // blocked

    // different key should still be allowed
    expect(checkRateLimit('key-b').allowed).toBe(true)
  })
})
