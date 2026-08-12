import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockVerifyBotToken = vi.fn()
const mockFindUnique = vi.fn()
const mockUpsert = vi.fn()

vi.mock('@/lib/botAuth', () => ({ verifyBotToken: mockVerifyBotToken }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    botEvidenceCache: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  },
}))

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/bot/evidence/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockVerifyBotToken.mockResolvedValue(true)
  mockFindUnique.mockResolvedValue(null)
  mockUpsert.mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn())
})

describe('POST /api/bot/evidence/fetch', () => {
  it('requires bot-token authentication before cache or network access', async () => {
    mockVerifyBotToken.mockResolvedValue(false)

    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'handian', word: '汉典' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, status: 401, text: '' })
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unknown source IDs before cache or network access', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'attacker_url', word: '汉典' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, status: 400, text: '' })
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects non-Han URL injection and client-supplied URL fields', async () => {
    const { POST } = await import('./route')
    const injectedWord = await POST(request({
      sourceId: 'handian',
      word: '汉/../../admin?url=https://evil.example',
    }))
    const injectedUrl = await POST(request({
      sourceId: 'handian',
      word: '汉典',
      url: 'https://evil.example',
    }))

    expect(injectedWord.status).toBe(400)
    expect(injectedUrl.status).toBe(400)
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns a fresh found cache hit without a network fetch', async () => {
    mockFindUnique.mockResolvedValue({
      status: 'found',
      text: 'cached evidence',
      fetchedAt: new Date(),
    })

    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'handian', word: '汉典' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 200, text: 'cached evidence' })
    expect(fetch).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('fetches and caches a miss using only the allowlisted URL', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      `<script>secret()</script><style>.hidden{}</style><p>${'x'.repeat(12_050)}</p>`,
      { status: 200 },
    ))

    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'handian', word: '诉讼费' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'https://www.zdic.net/hans/%E8%AF%89%E8%AE%BC%E8%B4%B9',
    )
    expect(payload).toEqual({ ok: true, status: 200, text: 'x'.repeat(12_000) })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        sourceId: 'handian',
        word: '诉讼费',
        status: 'found',
        text: 'x'.repeat(12_000),
      }),
    }))
  })

  it('short-circuits a fresh absence and refetches it after the 24-hour TTL', async () => {
    const freshAbsence = {
      status: 'absent',
      text: null,
      fetchedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 1_000),
    }
    mockFindUnique.mockResolvedValueOnce(freshAbsence)

    const { POST } = await import('./route')
    const freshResponse = await POST(request({ sourceId: 'moedict', word: '汉典' }))

    expect(freshResponse.status).toBe(200)
    expect(await freshResponse.json()).toEqual({ ok: false, status: 404, text: '' })
    expect(fetch).not.toHaveBeenCalled()

    mockFindUnique.mockResolvedValueOnce({
      ...freshAbsence,
      fetchedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1_000),
    })
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<p>new evidence</p>', { status: 200 }))

    const expiredResponse = await POST(request({ sourceId: 'moedict', word: '汉典' }))

    expect(await expiredResponse.json()).toEqual({ ok: true, status: 200, text: 'new evidence' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'https://www.moedict.tw/%E6%B1%89%E5%85%B8',
    )
  })

  it('refetches found evidence after the seven-day TTL', async () => {
    mockFindUnique.mockResolvedValue({
      status: 'found',
      text: 'stale evidence',
      fetchedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1_000),
    })
    vi.mocked(fetch).mockResolvedValue(new Response('<p>fresh evidence</p>', { status: 200 }))

    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'wikipedia', word: '汉典' }))

    expect(await response.json()).toEqual({ ok: true, status: 200, text: 'fresh evidence' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('follows only the first exact-word same-domain hwxnet anchor', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response([
        '<a href="/view/wrong.html">别词</a>',
        '<a href="/view/exact.html"><span>诉讼费</span></a>',
        '<a href="/view/later.html">诉讼费</a>',
      ].join(''), { status: 200 }))
      .mockResolvedValueOnce(new Response(
        '<script>doNotLeak()</script><p>诉讼费 拼音 sù sòng fèi</p>',
        { status: 200 },
      ))

    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'hwxnet_cidian', word: '诉讼费' }))

    expect(await response.json()).toEqual({
      ok: true,
      status: 200,
      text: '诉讼费 拼音 sù sòng fèi',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'https://cd.hwxnet.com/search.do?wd=%E8%AF%89%E8%AE%BC%E8%B4%B9',
    )
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(
      'https://cd.hwxnet.com/view/exact.html',
    )
  })

  it('does not follow or return hwxnet search text when the anchor text mismatches', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      '<a href="/view/poison.html">别词</a><p>private search-page text</p>',
      { status: 200 },
    ))

    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'hwxnet_cidian', word: '诉讼费' }))

    expect(await response.json()).toEqual({ ok: false, status: 404, text: '' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'absent', text: null }),
    }))
  })

  it('blocks off-domain redirects without retrying or caching them', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://evil.example/stolen' },
    }))

    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'baidu_baike', word: '汉典' }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ ok: false, status: 502, text: '' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('retries one unavailable response and never caches a hard failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(new Response('still unavailable', { status: 503 }))

    const { POST } = await import('./route')
    const response = await POST(request({ sourceId: 'wikipedia', word: '汉典' }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ ok: false, status: 502, text: '' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
