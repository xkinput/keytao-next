import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CachedPracticeSchemeVersion, PracticeSchemeKey } from '@/lib/services/practiceSchemeCache'

type CachedSchemeVersions = Record<PracticeSchemeKey, CachedPracticeSchemeVersion[]>
type PracticeSourcePreference = 'common500' | 'common1000' | 'article' | 'custom' | 'flyKey' | 'keytao630'
type PracticeModePreference = 'follow' | 'study'
type PracticeInputEnginePreference = 'system' | 'librime'

interface PracticeStore {
  selectedSchemeKey: PracticeSchemeKey
  cachedSchemeVersions: CachedSchemeVersions
  practiceSource: PracticeSourcePreference
  selectedArticleId: string
  practiceMode: PracticeModePreference
  practiceInputEngine: PracticeInputEnginePreference
  pureDoublePinyinPractice: boolean
  hasHydrated: boolean
  setSelectedSchemeKey: (schemeKey: PracticeSchemeKey) => void
  setPracticeSource: (source: PracticeSourcePreference) => void
  setSelectedArticleId: (articleId: string) => void
  setPracticeMode: (mode: PracticeModePreference) => void
  setPracticeInputEngine: (engine: PracticeInputEnginePreference) => void
  setPureDoublePinyinPractice: (enabled: boolean) => void
  upsertCachedSchemeVersion: (version: CachedPracticeSchemeVersion) => void
  removeCachedSchemeVersion: (schemeKey: PracticeSchemeKey, version: string) => void
  setHasHydrated: (state: boolean) => void
}

const EMPTY_CACHED_SCHEMES: CachedSchemeVersions = {
  keytao: [],
  xmjd: [],
  txjx: [],
  keydo: [],
}

function sortCachedVersions(versions: CachedPracticeSchemeVersion[]): CachedPracticeSchemeVersion[] {
  return [...versions].sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt))
}

export const usePracticeStore = create<PracticeStore>()(
  persist(
    (set) => ({
      selectedSchemeKey: 'keytao',
      cachedSchemeVersions: EMPTY_CACHED_SCHEMES,
      practiceSource: 'common500',
      selectedArticleId: 'builtin:default-longform',
      practiceMode: 'follow',
      practiceInputEngine: 'system',
      pureDoublePinyinPractice: false,
      hasHydrated: false,
      setSelectedSchemeKey: (schemeKey) => set({ selectedSchemeKey: schemeKey }),
      setPracticeSource: (practiceSource) => set({ practiceSource }),
      setSelectedArticleId: (selectedArticleId) => set({ selectedArticleId }),
      setPracticeMode: (practiceMode) => set({ practiceMode }),
      setPracticeInputEngine: (practiceInputEngine) => set({ practiceInputEngine }),
      setPureDoublePinyinPractice: (pureDoublePinyinPractice) => set({ pureDoublePinyinPractice }),
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
        practiceSource: state.practiceSource,
        selectedArticleId: state.selectedArticleId,
        practiceMode: state.practiceMode,
        practiceInputEngine: state.practiceInputEngine,
        pureDoublePinyinPractice: state.pureDoublePinyinPractice,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)

export type { CachedPracticeSchemeVersion, PracticeSchemeKey }
