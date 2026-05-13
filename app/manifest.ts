import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'KeyTao 星空键道6词库管理系统',
    short_name: 'KeyTao',
    description: '键道输入法、星空键道与键道6练习和词库管理系统',
    start_url: '/',
    display: 'standalone',
    background_color: '#111318',
    theme_color: '#111318',
    lang: 'zh-CN',
    icons: [
      {
        src: '/icon.png',
        sizes: '490x490',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}