import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Page filter state mapping
interface PageFilters {
  '/'?: string // 'all' | 'Draft' | 'Submitted' | 'Approved' | 'Published'
  '/pull-requests'?: string // 'all' | 'Pending' | 'Approved' | 'Rejected'
  '/admin/batches'?: string // 'Submitted' | 'Approved' | 'Rejected' | 'Published'
  [key: string]: string | undefined
}

interface PageNumbers {
  [key: string]: number | undefined
}

interface PageFilterStore {
  filters: PageFilters
  pages: PageNumbers
  setFilter: (page: string, filter: string) => void
  getFilter: (page: string, defaultValue?: string) => string
  setPage: (page: string, pageNumber: number) => void
  getPage: (page: string, defaultValue?: number) => number
  clearFilter: (page: string) => void
  clearAllFilters: () => void
}

export const usePageFilterStore = create<PageFilterStore>()(
  persist(
    (set, get) => ({
      filters: {},
      pages: {},

      setFilter: (page: string, filter: string) =>
        set((state) => ({
          filters: {
            ...state.filters,
            [page]: filter,
          },
          // Reset page to 1 when filter changes
          pages: {
            ...state.pages,
            [page]: 1,
          },
        })),

      getFilter: (page: string, defaultValue = '') => {
        const filters = get().filters
        return filters[page] || defaultValue
      },

      setPage: (page: string, pageNumber: number) =>
        set((state) => ({
          pages: {
            ...state.pages,
            [page]: pageNumber,
          },
        })),

      getPage: (page: string, defaultValue = 1) => {
        const pages = get().pages
        return pages[page] || defaultValue
      },

      clearFilter: (page: string) =>
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [page]: removedFilter, ...restFilters } = state.filters
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [page]: removedPage, ...restPages } = state.pages
          return { filters: restFilters, pages: restPages }
        }),

      clearAllFilters: () => set({ filters: {}, pages: {} }),
    }),
    {
      name: 'page-filter-storage',
    }
  )
)
