import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor config. The shell loads the web UI from the production deployment
 * (`server.url`) so web changes ship without a new APK; the bundled `webDir` is
 * the offline fallback. The native AlarmPlugin (the real persistence guarantee)
 * lives in the APK and is updated through Google Play or manual GitHub APKs.
 * GitHub distributes the
 * same Google-signed Play identity. The base appId below is for local/legacy
 * direct builds; the Play product flavor overrides its applicationId.
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
