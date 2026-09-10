import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// App version, surfaced to the client (the native update check compares it to the
// latest GitHub release).
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

/** The VITE_-prefixed process environment in loadEnv's shape, so exported values can win. */
function pickViteEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => key.startsWith('VITE_') && value !== undefined)
  ) as Record<string, string>
}

// Dev proxies /api and /ws to the API server so the browser talks to one origin.
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), 'VITE_')
  // loadEnv reads files only. Devkit and one-off shell overrides arrive through process.env.
  const env = { ...fileEnv, ...pickViteEnv(process.env) }
  const apiPort = env.VITE_API_PORT ?? '4000'

  return {
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
      // Host mode derives a per-checkout port. Off/devcontainer mode retains the fixed default.
      port: Number(env.VITE_DEV_PORT ?? 5173),
      // Devkit needs an explicit IPv4 bind for its host proxy. The existing all-interface bind
      // remains the default for devcontainer/WSL2 forwarding when devkit is off.
      host: env.VITE_DEV_HOST || true,
      allowedHosts: env.VITE_DEV_ALLOWED_HOSTS
        ? env.VITE_DEV_ALLOWED_HOSTS.split(',').map((host) => host.trim()).filter(Boolean)
        : undefined,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
        '/ws': { target: `ws://localhost:${apiPort}`, ws: true }
      }
    }
  }
})
