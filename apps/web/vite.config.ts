import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Dev proxies /api and /ws to the API server so the browser talks to one origin.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We hand-author the push handler; inject it into the generated SW.
      injectRegister: null,
      workbox: {
        importScripts: ['push-handler.js'],
        navigateFallbackDenylist: [/^\/api/, /^\/ws/]
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Persistent',
        short_name: 'Persistent',
        description: "Reminders that won't let you forget.",
        theme_color: '#0b0f19',
        background_color: '#0b0f19',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4000', ws: true }
    }
  }
})
