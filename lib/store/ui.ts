import { create } from 'zustand'

type FeedbackType = 'alert' | 'confirm'

interface FeedbackState {
    id: number
    isOpen: boolean
    type: FeedbackType
    title?: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    isLoading?: boolean
    onConfirm?: () => void | Promise<void>
    onCancel?: () => void
}

interface UIStore {
    feedback: FeedbackState
    openAlert: (message: string, title?: string) => void
    openConfirm: (
        message: string,
        onConfirm: () => void | Promise<void>,
        title?: string,
        confirmLabel?: string,
        cancelLabel?: string
    ) => void
    closeFeedback: () => void
    closeFeedbackIfCurrent: (id: number) => void
    setLoading: (loading: boolean) => void
}

let nextFeedbackId = 1

export const useUIStore = create<UIStore>((set) => ({
    feedback: {
        id: 0,
        isOpen: false,
        type: 'alert',
        message: ''
    },
    openAlert: (message, title = '提示') => set({
        feedback: {
            id: nextFeedbackId++,
            isOpen: true,
            type: 'alert',
            message,
            title,
            confirmLabel: '确定'
        }
    }),
    openConfirm: (message, onConfirm, title = '确认', confirmLabel = '确定', cancelLabel = '取消') => set({
        feedback: {
            id: nextFeedbackId++,
            isOpen: true,
            type: 'confirm',
            message,
            title,
            onConfirm,
            confirmLabel,
            cancelLabel
        }
    }),
    closeFeedback: () => set((state) => ({
        feedback: { ...state.feedback, isOpen: false }
    })),
    closeFeedbackIfCurrent: (id) => set((state) => (
        state.feedback.id === id
            ? { feedback: { ...state.feedback, isOpen: false } }
            : state
    )),
    setLoading: (loading) => set((state) => ({
        feedback: { ...state.feedback, isLoading: loading }
    }))
}))
