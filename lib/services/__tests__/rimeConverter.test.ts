import { PhraseType, PullRequestType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  convertPhrasesToRimeDicts,
  getAffectedPhraseTypesFromPullRequests,
} from '@/lib/services/rimeConverter'

describe('rimeConverter', () => {
  it('returns unique affected phrase types from pull requests', () => {
    const affectedTypes = getAffectedPhraseTypesFromPullRequests([
      {
        id: 1,
        createAt: new Date(),
        updateAt: new Date(),
        phraseId: null,
        targetPhraseId: null,
        targetFingerprint: null,
        needsManualReview: false,
        word: '测',
        oldWord: null,
        code: 'ce',
        type: PhraseType.Single,
        status: 'Approved',
        action: PullRequestType.Create,
        remark: null,
        weight: 1,
        hasConflict: false,
        conflictReason: null,
        userId: 1,
        batchId: 'batch-1',
      },
      {
        id: 2,
        createAt: new Date(),
        updateAt: new Date(),
        phraseId: null,
        targetPhraseId: null,
        targetFingerprint: null,
        needsManualReview: false,
        word: '测试',
        oldWord: null,
        code: 'ce shi',
        type: PhraseType.Phrase,
        status: 'Approved',
        action: PullRequestType.Change,
        remark: null,
        weight: 2,
        hasConflict: false,
        conflictReason: null,
        userId: 1,
        batchId: 'batch-1',
      },
      {
        id: 3,
        createAt: new Date(),
        updateAt: new Date(),
        phraseId: null,
        targetPhraseId: null,
        targetFingerprint: null,
        needsManualReview: false,
        word: '再测',
        oldWord: null,
        code: 'zai ce',
        type: PhraseType.Single,
        status: 'Approved',
        action: PullRequestType.Delete,
        remark: null,
        weight: null,
        hasConflict: false,
        conflictReason: null,
        userId: 1,
        batchId: 'batch-1',
      },
    ])

    expect(affectedTypes).toEqual([PhraseType.Single, PhraseType.Phrase])
  })

  it('generates only selected dictionary files and keeps empty affected types', () => {
    const dicts = convertPhrasesToRimeDicts(
      [
        {
          id: 1,
          createAt: new Date(),
          updateAt: new Date(),
          word: '测',
          code: 'ce',
          type: PhraseType.Single,
          status: 'Finish',
          remark: null,
          weight: 1,
          userId: 1,
        },
      ],
      '2026.03.08',
      {
        includeTypes: [PhraseType.Single, PhraseType.Phrase],
        includeEmptyTypes: true,
      }
    )

    expect(Array.from(dicts.keys())).toEqual([
      'keytao.single.dict.yaml',
      'keytao-dz.dict.yaml',
      'keytao-cx.dict.yaml',
      'keytao.phrase.dict.yaml',
    ])
    expect(dicts.get('keytao.single.dict.yaml')).toContain('version: "2026.03.08"')
    expect(dicts.get('keytao.phrase.dict.yaml')).toContain('name: keytao.phrase')
    expect(dicts.get('keytao.phrase.dict.yaml')).not.toContain('测\tce\t1')
  })
})
