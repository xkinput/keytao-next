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

  it('changes when any snapshot field changes', () => {
    const fingerprint = createPhraseTargetFingerprint(target)
    const mutations = [
      { id: 10 },
      { word: '黏贴' },
      { code: 'vztq' },
      { type: 'Single' },
      { status: 'Draft' },
      { weight: 2 },
      { remark: 'changed' },
      { userId: 43 },
    ]

    for (const mutation of mutations) {
      expect(createPhraseTargetFingerprint({ ...target, ...mutation })).not.toBe(fingerprint)
    }
  })

  it('uses the same snapshot for bind and approval recomputation when the row has extra columns', async () => {
    const row = {
      ...target,
      createAt: new Date('2026-02-01T00:00:00.000Z'),
      updateAt: new Date('2026-02-02T00:00:00.000Z'),
    }
    const findFirst = vi.fn(async () => row)

    const binding = await resolvePhraseTargetBinding({ findFirst } as never, {
      action: 'Delete', word: target.word, code: target.code, phraseId: target.id,
    })

    expect(binding.targetFingerprint).toBe(createPhraseTargetFingerprint(target))
    expect(createPhraseTargetFingerprint(row)).toBe(binding.targetFingerprint)
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
