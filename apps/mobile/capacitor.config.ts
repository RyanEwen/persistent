import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor config. The shell loads the web UI from the production deployment
 * (`server.url`) so web changes ship without a new APK; the bundled `webDir` is
 * the offline fallback. The native AlarmPlugin (the real persistence guarantee)
 * lives in the APK and is updated via GitHub releases + the in-app update check.
 *
 * webDir is the web build output; run the web build before `cap sync`.
 */
const config: CapacitorConfig = {
  appId: 'ca.persistent.app',
  appName: 'Persistent',
  webDir: '../web/dist',
  server: {
    url: 'https://persistent.dynamic-solutions.ca',
    cleartext: false
  },
  android: {
    allowMixedContent: false
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['alert', 'sound']
    }
  }
}

export default config
