import { spawnSync } from 'node:child_process'
import withSerwistInit from '@serwist/next'
import type { NextConfig } from 'next'

const offlineRevision = spawnSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf-8',
}).stdout.trim() || crypto.randomUUID()

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  additionalPrecacheEntries: [{ url: '/~offline', revision: offlineRevision }],
  globPublicPatterns: ['**/*', '!librime-wasm/**/*'],
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
})

const nextConfig: NextConfig = {
  reactCompiler: true,
}

export default withSerwist(nextConfig)
