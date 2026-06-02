import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist'
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const practiceRuntimeCache: RuntimeCaching[] = [
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/librime-wasm/'),
    handler: new CacheFirst({
      cacheName: 'practice-librime-runtime',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 16,
          maxAgeSeconds: 30 * 24 * 60 * 60,
          maxAgeFrom: 'last-used',
        }),
      ],
    }),
  },
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && (url.pathname === '/practice' || url.pathname.startsWith('/practice/')),
    handler: new StaleWhileRevalidate({
      cacheName: 'practice-page',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 8,
          maxAgeSeconds: 7 * 24 * 60 * 60,
          maxAgeFrom: 'last-used',
        }),
      ],
    }),
  },
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && [
      '/api/practice/articles',
      '/api/practice/keytao-config',
      '/api/practice/scheme-release',
    ].includes(url.pathname),
    handler: new NetworkFirst({
      cacheName: 'practice-api-data',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 24,
          maxAgeSeconds: 14 * 24 * 60 * 60,
          maxAgeFrom: 'last-used',
        }),
      ],
      networkTimeoutSeconds: 2,
    }),
  },
]

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...practiceRuntimeCache, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: '/~offline',
        matcher({ request }) {
          return request.destination === 'document'
        },
      },
    ],
  },
})

serwist.addEventListeners()
