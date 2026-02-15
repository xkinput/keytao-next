import { useAuthStore } from '@/lib/store/auth'

/**
 * Optimized auth hooks that only subscribe to specific fields
 * to prevent unnecessary re-renders when other auth state changes
 */

export function useIsAuthenticated() {
  return useAuthStore(state => state.isAuthenticated)
}

export function useAuthToken() {
  return useAuthStore(state => state.token)
}

export function useAuthUser() {
  return useAuthStore(state => state.user)
}

export function useSetAuth() {
  return useAuthStore(state => state.setAuth)
}

export function useClearAuth() {
  return useAuthStore(state => state.clearAuth)
}

export function useIsAdmin() {
  return useAuthStore(state => state.isAdmin)
}

export function useIsRootAdmin() {
  return useAuthStore(state => state.isRootAdmin)
}
