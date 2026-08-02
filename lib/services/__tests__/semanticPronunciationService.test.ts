import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestSemanticPronunciation } from '../semanticPronunciationService'

describe('semanticPronunciationService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('calls only the authenticated bot endpoint and validates the response', async () => {
    vi.stubEnv('BOT_API_URL', 'https://bot.internal/')
    vi.stubEnv('BOT_API_KEY', 'shared-secret')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      accepted: true,
      word: '攀着',
      pinyins: ['pan', 'zhe'],
      meaning: '表示正攀附着或抓住某物向上移动',
      confidence: 0.98,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestSemanticPronunciation('攀着', 'user-7')).resolves.toEqual({
      pinyins: ['pan', 'zhe'],
      meaning: '表示正攀附着或抓住某物向上移动',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://bot.internal/api/keytao/pronunciation')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer shared-secret',
        'Content-Type': 'application/json',
        'X-KeyTao-Requester': expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      body: JSON.stringify({ word: '攀着' }),
    })
  })

  it('rejects weak or malformed claims from the upstream service', async () => {
    vi.stubEnv('BOT_API_KEY', 'shared-secret')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      accepted: true,
      word: '看着',
      pinyins: ['kan', 'zhe'],
      meaning: 'x',
      confidence: 0.99,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestSemanticPronunciation('看着')).resolves.toBeNull()
  })

  it('does not make a billed request when server authentication is unconfigured', async () => {
    vi.stubEnv('BOT_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestSemanticPronunciation('望着')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('coalesces concurrent requests for the same word before the billed boundary', async () => {
    vi.stubEnv('BOT_API_KEY', 'shared-secret')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      accepted: true,
      word: '披着',
      pinyins: ['pi', 'zhe'],
      meaning: '表示某个东西正覆盖在主体表面',
      confidence: 0.96,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([
      requestSemanticPronunciation('披着', 'user-a'),
      requestSemanticPronunciation('披着', 'user-b'),
    ])

    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
