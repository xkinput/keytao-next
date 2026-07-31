import { createCanonicalDigest } from '@/lib/services/botWarningSnapshot'
import { detectPhraseType } from '@/lib/constants/phraseTypes'
import type { Prisma } from '@prisma/client'

export interface PhraseTargetSnapshot {
  id: number
  word: string
  code: string
  type: string
  status: string
  weight: number
  remark: string | null
  userId: number
}

export function createPhraseTargetFingerprint(target: PhraseTargetSnapshot): string {
  return createCanonicalDigest(target)
}

type PhraseTargetReader = Pick<Prisma.TransactionClient['phrase'], 'findFirst'>

export class PhraseTargetBindingError extends Error {
  readonly status = 409

  constructor() {
    super('修改或删除的目标词条已变化，请刷新后重试')
    this.name = 'PhraseTargetBindingError'
  }
}

export async function resolvePhraseTargetBinding(
  phrase: PhraseTargetReader,
  input: {
    action: string
    word: string
    oldWord?: string | null
    code: string
    type?: string | null
    phraseId?: number | null
  }
): Promise<{ targetPhraseId: number | null; targetFingerprint: string | null }> {
  if (input.action !== 'Change' && input.action !== 'Delete') {
    return { targetPhraseId: null, targetFingerprint: null }
  }
  const select = {
    id: true, word: true, code: true, type: true, status: true,
    weight: true, remark: true, userId: true,
  } as const
  const expectedWord = input.action === 'Change' ? input.oldWord ?? '' : input.word
  const target = await phrase.findFirst({
    where: {
      ...(input.phraseId ? { id: input.phraseId } : {}),
      word: expectedWord,
      code: input.code,
      type: (input.type || detectPhraseType(expectedWord, input.code)) as never,
    },
    select,
  })
  if (!target) throw new PhraseTargetBindingError()
  return {
    targetPhraseId: target.id,
    targetFingerprint: createPhraseTargetFingerprint(target),
  }
}
