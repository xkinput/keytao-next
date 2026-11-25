import { describe, expect, it } from 'vitest'
import { selectAiReviewFocusContext } from './batchBotReviewService'

describe('selectAiReviewFocusContext', () => {
  it('keeps just the target when other items are unrelated', () => {
    const target = { id: 1, word: '', code: 'abc', type: 'Phrase' }
    const unrelated = { id: 2, word: '', code: 'abcd', type: 'Other' }

    expect(selectAiReviewFocusContext([unrelated, target], 1)).toEqual([target])
  })

  it('includes the same word across different types and codes', () => {
    const target = { id: 1, word: null, phrase: { word: 'shared', code: 'abc' }, type: 'Phrase' }
    const sameWord = { id: 2, word: 'shared', code: 'xyz', type: 'Other' }

    expect(selectAiReviewFocusContext([sameWord, target], 1)).toEqual([target, sameWord])
  })

  it('follows prefix links transitively in breadth-first order', () => {
    const target = { id: 1, word: 'first', code: 'ABCDE' }
    const near = { id: 2, word: 'second', code: 'abcd', type: 'Phrase' }
    const bridge = { id: 3, word: 'third', code: null, phrase: { word: 'third', code: 'abc' } }
    const far = { id: 4, word: 'fourth', code: 'abcf' }

    expect(selectAiReviewFocusContext([far, near, bridge, target], 1)).toEqual([target, near, bridge, far])
  })

  it('excludes prefix neighbours when either code is shorter than three letters', () => {
    const target = { id: 1, word: 'first', code: 'ab' }
    const shortPrefix = { id: 2, word: 'second', code: 'abcd' }

    expect(selectAiReviewFocusContext([target, shortPrefix], 1)).toEqual([target])
  })

  it('follows persisted and dynamic dependencies in both directions', () => {
    const target = { id: 1, word: 'first', dependencies: [{ dependsOnId: 2 }] }
    const dependency = { id: 2, word: 'second', dependedBy: [{ dependent: { id: 3 } }] }
    const dependent = { id: 3, word: 'third' }
    const dynamic = { id: 4, word: 'fourth', dependencies: [{ dependsOn: { id: 3 } }] }
    const items = [target, dependency, dependent, dynamic]

    expect(selectAiReviewFocusContext(items, 1)).toEqual(items)
    expect(selectAiReviewFocusContext(items, 4)).toEqual([...items].reverse())
  })

  it('prioritizes items linked through a Change old word or matching rename pair', () => {
    const target = { id: 1, action: 'Change', oldWord: 'original', word: 'replacement' }
    const sameWord = { id: 2, word: 'replacement' }
    const oldWord = { id: 3, word: 'original' }
    const samePair = { ...target, id: 4 }

    expect(selectAiReviewFocusContext([sameWord, oldWord, samePair, target], 1))
      .toEqual([target, oldWord, samePair, sameWord])
  })

  it('caps the context at 24 with the target first and direct links ahead of rule neighbours', () => {
    const sameWordItems = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, word: 'shared' }))
    const target = { id: 26, word: 'shared', dependencies: [{ dependsOnId: 27 }] }
    const dependency = { id: 27, word: 'second', dependencies: [{ dependsOnId: 28 }] }
    const nextHop = { id: 28, word: 'third' }

    expect(selectAiReviewFocusContext([...sameWordItems, target, dependency, nextHop], 26))
      .toEqual([target, dependency, ...sameWordItems.slice(0, 22)])
  })
})
