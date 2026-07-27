import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon.svg'],
      manifest: {
        name: 'AusTopo — Australian Topographic Maps',
        short_name: 'AusTopo',
        description:
          'Detailed topographic maps of Australia with GPS location and place search.',
        theme_color: '#1b5e20',
        background_color: '#e9f2ea',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // The app shell is precached at build time.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Map tiles are cached at runtime (CacheFirst) so any region you've
        // viewed OR explicitly downloaded is available offline. This same cache
        // is populated by the "download for offline" feature.
        runtimeCaching: [
          {
            urlPattern:
              /^https:\/\/([abc]\.tile\.opentopomap\.org|server\.arcgisonline\.com)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxEntries: 8000,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
