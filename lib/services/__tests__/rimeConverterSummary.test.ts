import { describe, expect, it } from 'vitest'
import { PhraseType, PullRequestType } from '@prisma/client'
import { generateReleaseNotes, generateSyncSummary, generateSyncSummaryData } from '../rimeConverter'
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

  it('renders concise release notes with entry counts, contributors, and PR link', () => {
    const data = generateSyncSummaryData(pullRequests, batches)
    const notes = generateReleaseNotes(data, {
      prUrl: 'https://github.com/xkinput/KeyTao/pull/180',
      prNumber: 180,
    })

    expect(notes).toContain('- 总计：**4** 条词条')
    expect(notes).toContain('- **词组**：新增 2，修改 1')
    expect(notes).toContain('- **单字**：删除 1')
    expect(notes).toContain('### 参与贡献（2 位）')
    expect(notes).toContain('Rea、GarthTB')
    expect(notes).toContain('[PR #180](https://github.com/xkinput/KeyTao/pull/180)')
    expect(notes).not.toContain('Co-authored-by:')
    expect(notes).not.toContain('此PR由KeyTao管理系统自动生成')
  })
})
