import { describe, expect, it } from 'vitest'
import { POST } from './route'

describe('retired batch rejection endpoint', () => {
  it('directs callers to item review without rejecting a batch', async () => {
    const response = POST()
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ error: '请在审核页为词条分别记录审核决定' })
  })
})
