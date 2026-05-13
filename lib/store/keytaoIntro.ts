import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface KeytaoIntroStore {
  isOpen: boolean
  hasSeenIntro: boolean
  hasHydrated: boolean
  hasAutoOpened: boolean
  openIntroModal: () => void
  closeIntroModal: () => void
  acknowledgeIntroModal: () => void
  markAutoOpened: () => void
  setHasHydrated: (state: boolean) => void
}

export const useKeytaoIntroStore = create<KeytaoIntroStore>()(
  persist(
    (set) => ({
      isOpen: false,
      hasSeenIntro: false,
      hasHydrated: false,
      hasAutoOpened: false,
      openIntroModal: () => set({ isOpen: true }),
      closeIntroModal: () => set({ isOpen: false }),
      acknowledgeIntroModal: () => set({ isOpen: false, hasSeenIntro: true }),
      markAutoOpened: () => set({ hasAutoOpened: true }),
      setHasHydrated: (state) => set({ hasHydrated: state }),
    }),
    {
      name: 'keytao-intro-storage',
      partialize: (state) => ({
        hasSeenIntro: state.hasSeenIntro,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)