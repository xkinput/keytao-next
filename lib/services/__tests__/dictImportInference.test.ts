import { describe, expect, it } from 'vitest'

import { resolveDictImportInference } from '../dictImportInference'
import type { InferResponse } from '../phraseInference'

function inference(overrides: Partial<InferResponse>): InferResponse {
  return {
    word: '攀着',
    type: '二字词',
    codes: ['pffl', 'pfflo'],
    altCodes: [],
    flyKeyVariants: [],
    suggestion: null,
    suggestionStatus: 'occupied',
    suggestionIndex: 0,
    isBaseConflict: true,
    wordExists: [],
    ...overrides,
  }
}

describe('resolveDictImportInference', () => {
  it('leaves an ambiguous pronunciation blank instead of treating it as overflow', () => {
    const result = resolveDictImportInference(undefined, inference({
      semanticPronunciationNeeded: true,
      suggestionStatus: 'pronunciation-unresolved',
    }))

    expect(result.status).toBe('error')
    expect(result.finalCode).toBe('')
    expect(result.statusDetail).toContain('读音存在歧义')
  })

  it('uses the longest code only when every verified code slot is occupied', () => {
    expect(resolveDictImportInference(undefined, inference({}))).toEqual({
      finalCode: 'pfflo',
      status: 'overflow',
    })
  })

  it('leaves the code blank when the authority service is unavailable', () => {
    const result = resolveDictImportInference(undefined, inference({
      pronunciationSource: 'zdic-unavailable',
      suggestionStatus: 'pronunciation-unavailable',
    }))

    expect(result.status).toBe('error')
    expect(result.finalCode).toBe('')
    expect(result.statusDetail).toContain('权威读音服务暂不可用')
  })

  it('fails closed for an inconsistent null suggestion status', () => {
    const result = resolveDictImportInference(undefined, inference({
      suggestionStatus: 'available',
    }))

    expect(result.status).toBe('error')
    expect(result.finalCode).toBe('')
  })
})
