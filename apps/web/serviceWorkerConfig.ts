/**
 * Online launches use the current HTML; offline launches use the matching precache.
 * Default precache navigation would undo a build-check reload until the worker catches
 * up. No runtime HTML cache is kept, since it can outlive its content-hashed assets.
 */
import type { VitePWAOptions } from 'vite-plugin-pwa'

export const navigationCaching: NonNullable<NonNullable<VitePWAOptions['workbox']>['runtimeCaching']>[number] = {
  urlPattern: ({ request, url }) => request.mode === 'navigate'
    && !/^\/(?:api|ws)(?:\/|$)/i.test(url.pathname),
  handler: 'NetworkOnly',
  options: {
    precacheFallback: { fallbackURL: 'index.html' },
    plugins: [{
      fetchDidSucceed: async ({ response }: { response: Response }) => {
        if (response.ok) return response
        throw new Error(`Navigation request failed with ${response.status}`)
      }
    }]
  }
}
