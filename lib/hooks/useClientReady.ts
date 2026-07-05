'use client'

import { useSyncExternalStore } from 'react'

function subscribeClientReady() {
  return () => undefined
}

export function useClientReady() {
  return useSyncExternalStore(subscribeClientReady, () => true, () => false)
}
