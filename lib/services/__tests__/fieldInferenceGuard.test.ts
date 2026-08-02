import { describe, expect, it } from 'vitest'

import {
  FieldInferenceRequestTracker,
  findCurrentFieldIndex,
} from '../fieldInferenceGuard'

describe('fieldInferenceGuard', () => {
  it('rejects an older response that completes after a newer word request', () => {
    const tracker = new FieldInferenceRequestTracker()
    const oldRequest = tracker.begin('field-a', '攀着')
    const currentRequest = tracker.begin('field-a', '穨茶')
    const fields = [{ id: 'field-a' }]
    const values = [{ word: '穨茶', code: '' }]

    expect(findCurrentFieldIndex(fields, values, oldRequest, tracker)).toBe(-1)
    expect(findCurrentFieldIndex(fields, values, currentRequest, tracker)).toBe(0)
  })

  it('resolves the current index by stable field id after rows are reordered', () => {
    const tracker = new FieldInferenceRequestTracker()
    const request = tracker.begin('field-a', '攀着', 'pfqe')

    expect(findCurrentFieldIndex(
      [{ id: 'field-b' }, { id: 'field-a' }],
      [{ word: '穨茶', code: 'xwwso' }, { word: '攀着', code: 'pfqe' }],
      request,
      tracker,
    )).toBe(1)
  })

  it('rejects a response after its code changes or field is removed', () => {
    const tracker = new FieldInferenceRequestTracker()
    const request = tracker.begin('field-a', '攀着', 'pffl')

    expect(findCurrentFieldIndex(
      [{ id: 'field-a' }],
      [{ word: '攀着', code: 'pfqe' }],
      request,
      tracker,
    )).toBe(-1)

    tracker.forget('field-a')
    expect(findCurrentFieldIndex([], [], request, tracker)).toBe(-1)
  })

  it('does not revive an old response when the tracker is cleared and reused', () => {
    const tracker = new FieldInferenceRequestTracker()
    const oldRequest = tracker.begin('field-a', '攀着')
    tracker.clear()
    const newRequest = tracker.begin('field-a', '攀着')
    const fields = [{ id: 'field-a' }]
    const values = [{ word: '攀着', code: '' }]

    expect(findCurrentFieldIndex(fields, values, oldRequest, tracker)).toBe(-1)
    expect(findCurrentFieldIndex(fields, values, newRequest, tracker)).toBe(0)
  })
})
