/** Host-specific content and destinations for the native-app promotion banner. */

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=ca.dynamicsolutions.persistent'
export const WINDOWS_STORE_URL = 'https://apps.microsoft.com/detail/9PCX2XGQ7CJS'

// This key is deliberately unversioned: dismissal means never show this promo
// again on this installation, including after app and service-worker updates.
export const APP_PROMO_DISMISSED_KEY = 'persistent-hide-native-apps-banner'

export type NativeAppsPromoHost = 'android' | 'windows' | 'web'

export interface NativeAppsPromotion {
  title: string
  description: string
  showAndroid: boolean
  showWindows: boolean
}

/** Describe the useful companion app or apps without promoting the current host. */
export function getNativeAppsPromotion(host: NativeAppsPromoHost): NativeAppsPromotion {
  if (host === 'android') {
    return {
      title: 'Persistent is available for Windows',
      description:
        'Keep reminders in your system tray, see what is upcoming in a widget, and get persistent notifications and alarm audio while your PC is awake.',
      showAndroid: false,
      showWindows: true
    }
  }

  if (host === 'windows') {
    return {
      title: 'Get reliable alarms on Android',
      description: 'The Android app provides reliable, undismissable alarms that can reach you even offline.',
      showAndroid: true,
      showWindows: false
    }
  }

  return {
    title: 'Persistent on Android and Windows',
    description:
      'Use Android for hard alarm guarantees. The Windows companion adds tray access, an upcoming widget, and persistent alerts while your PC is awake.',
    showAndroid: true,
    showWindows: true
  }
}
