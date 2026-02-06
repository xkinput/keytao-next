'use client'

import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react'
import { useUIStore } from '@/lib/store/ui'
import { useState } from 'react'

export default function GlobalFeedback() {
    const { feedback, closeFeedback, setLoading } = useUIStore()
    const { isOpen, type, title, message, onConfirm, onCancel, confirmLabel, cancelLabel, isLoading } = feedback
    const [processing, setProcessing] = useState(false)

    const handleConfirm = async () => {
        if (onConfirm) {
            setProcessing(true)
            setLoading(true)
            try {
                await onConfirm()
                closeFeedback()
            } catch (error) {
                // Keep modal open and show error
                const err = error as Error
                setProcessing(false)
                setLoading(false)

                // Close confirm modal and show error alert
                closeFeedback()

                // Wait for modal to close
                setTimeout(() => {
                    const { openAlert } = useUIStore.getState()
                    openAlert(err.message || '操作失败', '错误')
                }, 150)
            } finally {
                setProcessing(false)
                setLoading(false)
            }
        } else {
            closeFeedback()
        }
    }

    const handleCancel = () => {
        if (onCancel) onCancel()
        closeFeedback()
    }

    return (
        <Modal isOpen={isOpen} onClose={handleCancel} hideCloseButton={false} size="2xl" scrollBehavior="inside">
            <ModalContent>
                {() => (
                    <>
                        <ModalHeader className="flex flex-col gap-1">
                            {title}
                        </ModalHeader>
                        <ModalBody className="max-h-[60vh] overflow-y-auto">
                            <p className="whitespace-pre-line text-sm">{message}</p>
                        </ModalBody>
                        <ModalFooter>
                            {type === 'confirm' && (
                                <Button variant="light" onPress={handleCancel} isDisabled={processing || isLoading}>
                                    {cancelLabel || '取消'}
                                </Button>
                            )}
                            <Button
                                color={type === 'confirm' ? "primary" : "default"}
                                onPress={handleConfirm}
                                isLoading={processing || isLoading}
                            >
                                {confirmLabel || '确定'}
                            </Button>
                        </ModalFooter>
                    </>
                )}
            </ModalContent>
        </Modal>
    )
}
