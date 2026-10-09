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
// ADB reverse exposes the checkout on the phone's loopback interface. Restrict
// this build-time override to loopback so a dev test cannot expose HTTP sessions.
const devUrl = process.env.PERSISTENT_ANDROID_DEV_URL
if (devUrl) {
  const parsed = new URL(devUrl)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('PERSISTENT_ANDROID_DEV_URL must use a loopback hostname (with adb reverse).')
  }
}

const config: CapacitorConfig = {
  appId: 'ca.persistent.app',
  appName: 'Persistent',
  webDir: '../web/dist',
  server: {
    url: devUrl ?? 'https://persistent.dynamic-solutions.ca',
    cleartext: Boolean(devUrl?.startsWith('http:'))
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
