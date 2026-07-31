import { describe, expect, it, vi } from 'vitest'
import {
  createPhraseTargetFingerprint,
  PhraseTargetBindingError,
  resolvePhraseTargetBinding,
} from './phraseTargetBinding'

describe('phrase target fingerprint', () => {
  const target = {
    id: 9, word: '粘贴', code: 'vztp', type: 'Phrase', status: 'Finish',
    weight: 1, remark: null, userId: 42,
  }

  it('changes when the same id is reused or any critical field changes', () => {
    const fingerprint = createPhraseTargetFingerprint(target)
    expect(createPhraseTargetFingerprint({ ...target, word: '黏贴' })).not.toBe(fingerprint)
    expect(createPhraseTargetFingerprint({ ...target, weight: 2 })).not.toBe(fingerprint)
    expect(createPhraseTargetFingerprint({ ...target, id: 10 })).not.toBe(fingerprint)
  })

  it('binds Change/Delete by stable entity id and fails closed when absent', async () => {
    const findFirst = vi.fn(async (): Promise<typeof target | null> => target)
    const phrase = { findFirst } as never

    await expect(resolvePhraseTargetBinding(phrase, {
      action: 'Delete', word: target.word, code: target.code, phraseId: target.id,
    })).resolves.toEqual({
      targetPhraseId: target.id,
      targetFingerprint: createPhraseTargetFingerprint(target),
    })

    findFirst.mockResolvedValueOnce(null)
    await expect(resolvePhraseTargetBinding(phrase, {
      action: 'Delete', word: target.word, code: target.code, phraseId: target.id,
    })).rejects.toBeInstanceOf(PhraseTargetBindingError)
  })

  it('rejects a supplied phrase id that does not match the displayed target tuple', async () => {
    const findFirst = vi.fn(async () => null)

    await expect(resolvePhraseTargetBinding({ findFirst } as never, {
      action: 'Delete',
      word: '显示目标',
      code: 'xsmb',
      type: 'Phrase',
      phraseId: 999,
    })).rejects.toBeInstanceOf(PhraseTargetBindingError)

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 999,
        word: '显示目标',
        code: 'xsmb',
        type: 'Phrase',
      },
    }))
  })
})
