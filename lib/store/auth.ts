import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: number
  name: string
  nickname?: string | null
  roles?: any[]
}

interface AuthState {
  token: string | null
  user: User | null
  isAdmin: boolean
  isRootAdmin: boolean
  _adminChecked: boolean
  setAuth: (token: string, user: User) => void
  setAdminStatus: (isAdmin: boolean, isRootAdmin: boolean) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
  _hasHydrated: boolean
  setHasHydrated: (state: boolean) => void
}

const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAdmin: false,
      isRootAdmin: false,
      _adminChecked: false,
      _hasHydrated: false,
      setAuth: (token, user) => set({ token, user, _adminChecked: false }),
      setAdminStatus: (isAdmin, isRootAdmin) => set({ isAdmin, isRootAdmin, _adminChecked: true }),
      clearAuth: () => set({ token: null, user: null, isAdmin: false, isRootAdmin: false, _adminChecked: false }),
      isAuthenticated: () => {
        const token = get().token
        return !!token && !isTokenExpired(token)
      },
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'auth-storage',
      onRehydrateStorage: () => (state) => {
        if (state?.token && isTokenExpired(state.token)) {
          state.clearAuth()
        } else {
          state?.setHasHydrated(true)
        }
      },
    }
  )
)
