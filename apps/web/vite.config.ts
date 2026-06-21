import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// App version, surfaced to the client (the native update check compares it to the
// latest GitHub release).
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

// Dev proxies /api and /ws to the API server so the browser talks to one origin.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
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
    // Bind all interfaces (IPv4 + IPv6), not just ::1. Devcontainer/WSL2 port
    // forwarding reaches the server over 127.0.0.1; an IPv6-only bind refuses it.
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4000', ws: true }
    }
  }
})
