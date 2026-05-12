import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CachedPracticeSchemeVersion, PracticeSchemeKey } from '@/lib/services/practiceSchemeCache'

type CachedSchemeVersions = Record<PracticeSchemeKey, CachedPracticeSchemeVersion[]>

interface PracticeStore {
  selectedSchemeKey: PracticeSchemeKey
  cachedSchemeVersions: CachedSchemeVersions
  hasHydrated: boolean
  setSelectedSchemeKey: (schemeKey: PracticeSchemeKey) => void
  upsertCachedSchemeVersion: (version: CachedPracticeSchemeVersion) => void
  removeCachedSchemeVersion: (schemeKey: PracticeSchemeKey, version: string) => void
  setHasHydrated: (state: boolean) => void
}

const EMPTY_CACHED_SCHEMES: CachedSchemeVersions = {
  keytao: [],
  xmjd: [],
  txjx: [],
}

function sortCachedVersions(versions: CachedPracticeSchemeVersion[]): CachedPracticeSchemeVersion[] {
  return [...versions].sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt))
}

export const usePracticeStore = create<PracticeStore>()(
  persist(
    (set) => ({
      selectedSchemeKey: 'keytao',
      cachedSchemeVersions: EMPTY_CACHED_SCHEMES,
      hasHydrated: false,
      setSelectedSchemeKey: (schemeKey) => set({ selectedSchemeKey: schemeKey }),
      upsertCachedSchemeVersion: (version) => set((state) => {
        const currentVersions = state.cachedSchemeVersions[version.schemeKey] ?? []
        const nextVersions = sortCachedVersions([
          version,
          ...currentVersions.filter((item) => item.version !== version.version),
        ])

        return {
          cachedSchemeVersions: {
            ...state.cachedSchemeVersions,
            [version.schemeKey]: nextVersions,
          },
        }
      }),
      removeCachedSchemeVersion: (schemeKey, version) => set((state) => ({
        cachedSchemeVersions: {
          ...state.cachedSchemeVersions,
          [schemeKey]: (state.cachedSchemeVersions[schemeKey] ?? []).filter((item) => item.version !== version),
        },
      })),
      setHasHydrated: (state) => set({ hasHydrated: state }),
    }),
    {
      name: 'practice-storage',
      partialize: (state) => ({
        selectedSchemeKey: state.selectedSchemeKey,
        cachedSchemeVersions: state.cachedSchemeVersions,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)

export type { CachedPracticeSchemeVersion, PracticeSchemeKey }
