import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Custom service worker so we can handle `push` and `notificationclick`
      // events for the daily check-in reminders. Workbox runtime caching now
      // lives inline in src/sw.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}']
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Ember',
        short_name: 'Ember',
        description: 'A small daily journal for tracking sleep, focus, and movement.',
        theme_color: '#1C1612',
        background_color: '#1C1612',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // SVG icons render cleanly on Chrome/Edge/Android. For a custom iOS
        // home-screen icon, drop a 180×180 PNG at /public/apple-touch-icon.png.
        "icons": [
        {
            "src": "/icon-192.png",
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "any"
        },
        {
            "src": "/icon-512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "maskable"
        }]
      }
    })
  ],
  server: {
    port: 5173
  }
})
