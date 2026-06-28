/**
 * Bridge to the native Android AlarmPlugin (Kotlin), which schedules on-device
 * exact alarms that fire offline and show an ongoing/full-screen notification.
 * On the web (non-native) these are no-ops — the service worker path handles
 * best-effort notifications there. See docs/alarm-architecture.md.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface ScheduledAlarm {
  /** Occurrence id — the alarm's stable key and what we ack against. */
  occurrenceId: string
  /** Epoch milliseconds when the alarm should fire. */
  fireAtMs: number
  title: string
  body: string
  /** Loop the alarm sound every N seconds until acknowledged; 0 = single sound. */
  soundIntervalSeconds: number
  /** ALARM: looping sound + full-screen until Done. Otherwise a sound-once notification. */
  alarm: boolean
  /** Stays put / re-appears if swiped (true for both persistence levels). */
  ongoing: boolean
  /** Chosen sound URI; '' = system default for the type. */
  soundUri: string
  /** Parent reminder id, so tapping the notification opens its editor. */
  reminderId: string
  /**
   * This alarm is an escalation that can be silenced — stop the alarm but keep the
   * reminder nagging. Shows a "Silence" action; false for inherent ALARM reminders
   * (no softer nag to fall back to).
   */
  canSilence: boolean
  /**
   * Where this reminder's notification sits in the shade (visual only):
   * INHERIT = use the device default, else NORMAL / MINIMIZED. Ignored for
   * escalations/alarms, which always stay prominent.
   */
  shadeProminence: 'INHERIT' | 'NORMAL' | 'MINIMIZED'
}

export interface AlarmPluginPlugin {
  schedule(options: ScheduledAlarm): Promise<void>
  scheduleAll(options: { alarms: ScheduledAlarm[] }): Promise<void>
  cancel(options: { occurrenceId: string }): Promise<void>
  cancelAll(): Promise<void>
  /** Stop a ringing escalation alarm but leave its notification nagging (no ack). */
  silence(options: { occurrenceId: string }): Promise<void>
  requestBatteryExemption(): Promise<{ granted: boolean }>
  canScheduleExactAlarms(): Promise<{ allowed: boolean }>
  /**
   * Whether a fired alarm can actually be shown. `notifications` false
   * (POST_NOTIFICATIONS denied) means a ringing alarm would have no visible/
   * stoppable surface; `fullScreen`/`exactAlarms` degrade reliability only.
   */
  alarmReadiness(): Promise<{ notifications: boolean; fullScreen: boolean; exactAlarms: boolean }>
  /**
   * Set the device default shade prominence (for reminders set to INHERIT) and
   * re-post any live notifications so the change applies immediately.
   */
  setDefaultShadeProminence(options: { minimized: boolean }): Promise<void>
  /** Ensure the full-screen alarm may show over the lock screen (Android 14+ gate);
   * opens the per-app setting if not yet granted. */
  ensureFullScreenIntent(): Promise<{ allowed: boolean }>

  /** Open the system ringtone picker; returns the chosen uri + title (or cancelled). */
  pickSound(options: { type: 'alarm' | 'notification'; current?: string }): Promise<{
    uri?: string
    title?: string
    cancelled?: boolean
  }>
  drainPendingAcks(): Promise<{ occurrenceIds: string[] }>
  /** Snoozes made from the native notification, awaiting POST to the server. */
  drainPendingSnoozes(): Promise<{ snoozes: { occurrenceId: string; minutes: number }[] }>
  /** Silences made from the native alarm, awaiting POST to the server. */
  drainPendingSilences(): Promise<{ occurrenceIds: string[] }>
  /** Reminder id from a tapped notification (cleared on read); '' if none. */
  consumePendingNavigation(): Promise<{ reminderId: string }>
}

export const AlarmPlugin = registerPlugin<AlarmPluginPlugin>('AlarmPlugin')

/** State emitted by the native Update plugin while downloading/installing an APK. */
export interface UpdateState {
  state: 'downloading' | 'ready' | 'failed'
}

export interface UpdatePluginPlugin {
  /** Download the APK at `url` and launch the system installer when it finishes. */
  downloadAndInstall(options: { url: string }): Promise<void>
}

export const UpdatePlugin = registerPlugin<UpdatePluginPlugin>('Update')

/** Minimal proxy to @capacitor/app's getInfo — the installed APK's versionName. */
export const NativeApp = registerPlugin<{ getInfo(): Promise<{ version: string; build: string }> }>('App')

/**
 * Native passkey bridge to Android's Credential Manager (the WebView lacks
 * navigator.credentials). Takes WebAuthn options JSON, returns the credential
 * response JSON for the server to verify.
 */
export interface PasskeyNativePlugin {
  createPasskey(options: { options: string }): Promise<{ response: string }>
  getPasskey(options: { options: string }): Promise<{ response: string }>
}

export const PasskeyNative = registerPlugin<PasskeyNativePlugin>('Passkey')

/** Native Sign in with Google via Credential Manager; returns an ID token (JWT). */
export interface GoogleAuthNativePlugin {
  signIn(options: { serverClientId: string }): Promise<{ idToken: string }>
}

export const GoogleAuthNative = registerPlugin<GoogleAuthNativePlugin>('GoogleAuth')

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}
