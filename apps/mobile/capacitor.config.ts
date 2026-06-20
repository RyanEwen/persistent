import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor config. The native app ships the built web bundle (so the UI and
 * on-device alarms work offline) and talks to the hosted API. Point
 * `server.url` at your deployment for the data/API calls, or rely on the bundled
 * assets + the API base configured in the web app.
 *
 * webDir is the web build output; run the web build before `cap sync`.
 */
const config: CapacitorConfig = {
  appId: 'ca.persistent.app',
  appName: 'Persistent',
  webDir: '../web/dist',
  android: {
    // Allow http during local dev against a LAN API; tighten for release.
    allowMixedContent: true
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['alert', 'sound']
    }
  }
}

export default config
