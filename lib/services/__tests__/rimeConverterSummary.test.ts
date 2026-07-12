import { describe, expect, it } from 'vitest'
import { PhraseType, PullRequestType } from '@prisma/client'
import { generateSyncSummary, generateSyncSummaryData } from '../rimeConverter'
import type { PullRequest } from '@prisma/client'

function pullRequest(type: PhraseType, action: PullRequestType): PullRequest {
  return { type, action } as PullRequest
}

describe('Rime sync summary', () => {
  const pullRequests = [
    pullRequest(PhraseType.Phrase, PullRequestType.Create),
    pullRequest(PhraseType.Phrase, PullRequestType.Create),
    pullRequest(PhraseType.Phrase, PullRequestType.Change),
    pullRequest(PhraseType.Single, PullRequestType.Delete),
  ]
  const batches = [
    { creator: { name: 'Rea', nickname: null, email: 'rea@example.com' } },
    { creator: { name: 'Rea', nickname: null, email: 'rea@example.com' } },
    { creator: { name: 'Garth', nickname: 'GarthTB', email: 'garth@example.com' } },
  ]

  it('provides structured contributors and per-type counts', () => {
    expect(generateSyncSummaryData(pullRequests, batches)).toEqual({
      contributors: ['Rea', 'GarthTB'],
      totalEntries: 3,
      stats: [
        { type: '词组', create: 2, change: 1, delete: 0 },
        { type: '单字', create: 0, change: 0, delete: 1 },
      ],
    })
  })

  it('renders the PR body from the same structured summary', () => {
    const summary = generateSyncSummary(pullRequests, batches)

    expect(summary).toContain('Rea、GarthTB')
    expect(summary).toContain('- 总计: **3** 条词条')
    expect(summary).toContain('- **词组**: 新增 2, 修改 1')
    expect(summary).toContain('- **单字**: 删除 1')
  })
})
