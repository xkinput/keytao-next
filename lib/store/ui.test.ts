import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from './ui'

describe('useUIStore feedback lifecycle', () => {
    beforeEach(() => {
        useUIStore.setState({
            feedback: {
                id: 0,
                isOpen: false,
                type: 'alert',
                message: '',
            },
        })
    })

    it('closes the current feedback after loading updates', () => {
        const store = useUIStore.getState()

        store.openConfirm('Submit batch?', () => {})
        const feedbackId = useUIStore.getState().feedback.id

        useUIStore.getState().setLoading(true)
        useUIStore.getState().closeFeedbackIfCurrent(feedbackId)

        expect(useUIStore.getState().feedback.isOpen).toBe(false)
    })

    it('keeps replacement feedback open when an earlier feedback tries to close', () => {
        const store = useUIStore.getState()

        store.openConfirm('Submit batch?', () => {})
        const firstFeedbackId = useUIStore.getState().feedback.id

        useUIStore.getState().openConfirm('Warnings need confirmation', () => {})
        useUIStore.getState().closeFeedbackIfCurrent(firstFeedbackId)

        expect(useUIStore.getState().feedback).toMatchObject({
            isOpen: true,
            type: 'confirm',
            message: 'Warnings need confirmation',
        })
    })
})
