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
            } finally {
                setProcessing(false)
                setLoading(false)
                closeFeedback()
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
        <Modal isOpen={isOpen} onClose={handleCancel} hideCloseButton={false}>
            <ModalContent>
                {() => (
                    <>
                        <ModalHeader className="flex flex-col gap-1">
                            {title}
                        </ModalHeader>
                        <ModalBody>
                            <p>{message}</p>
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
