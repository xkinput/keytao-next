import { create } from 'zustand'

type FeedbackType = 'alert' | 'confirm'

interface FeedbackState {
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
    setLoading: (loading: boolean) => void
}

export const useUIStore = create<UIStore>((set) => ({
    feedback: {
        isOpen: false,
        type: 'alert',
        message: ''
    },
    openAlert: (message, title = '提示') => set({
        feedback: {
            isOpen: true,
            type: 'alert',
            message,
            title,
            confirmLabel: '确定'
        }
    }),
    openConfirm: (message, onConfirm, title = '确认', confirmLabel = '确定', cancelLabel = '取消') => set({
        feedback: {
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
    setLoading: (loading) => set((state) => ({
        feedback: { ...state.feedback, isLoading: loading }
    }))
}))
