import { describe, expect, it } from 'vitest'
import { orderPullRequestsForApproval } from '../batchApprovalService'
import type { BatchConflictResult } from '../batchConflictService'

describe('orderPullRequestsForApproval', () => {
  it('runs resolver operations before dependent creates', () => {
    const pullRequests = [
      { id: 2716, action: 'Create', word: '小恙', code: 'xcypio' },
      { id: 2718, action: 'Create', word: '小藏羚', code: 'xzli' },
      { id: 2728, action: 'Change', oldWord: '小恙', word: '小羊', code: 'xcypio' },
    ]
    const conflictResults: BatchConflictResult[] = [
      {
        id: '2716',
        calculatedWeight: 101,
        conflict: {
          hasConflict: false,
          code: 'xcypio',
          impact: '编码 "xcypio" 已被词条 "小羊" 占用，将创建重码',
          suggestions: [{
            action: 'Resolved',
            word: '小恙',
            reason: '第 3 个操作将 "小恙" 修改为 "小羊"，释放了词名',
            resolverIndex: 2,
          }],
        },
      },
      {
        id: '2718',
        conflict: {
          hasConflict: false,
          code: 'xzli',
          suggestions: [],
        },
      },
      {
        id: '2728',
        conflict: {
          hasConflict: false,
          code: 'xcypio',
          suggestions: [],
        },
      },
    ]

    const ordered = orderPullRequestsForApproval(pullRequests, conflictResults)

    expect(ordered.map(item => item.id)).toEqual([2718, 2728, 2716])
  })

  it('keeps the original order when there are no resolver dependencies', () => {
    const pullRequests = [
      { id: 1, action: 'Create' },
      { id: 2, action: 'Change' },
    ]
    const conflictResults: BatchConflictResult[] = [
      {
        id: '1',
        conflict: {
          hasConflict: false,
          code: 'a',
          suggestions: [],
        },
      },
      {
        id: '2',
        conflict: {
          hasConflict: false,
          code: 'b',
          suggestions: [],
        },
      },
    ]

    const ordered = orderPullRequestsForApproval(pullRequests, conflictResults)

    expect(ordered).toEqual(pullRequests)
  })
})
