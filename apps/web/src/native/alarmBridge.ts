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
}

export interface AlarmPluginPlugin {
  schedule(options: ScheduledAlarm): Promise<void>
  scheduleAll(options: { alarms: ScheduledAlarm[] }): Promise<void>
  cancel(options: { occurrenceId: string }): Promise<void>
  cancelAll(): Promise<void>
  requestBatteryExemption(): Promise<{ granted: boolean }>
  canScheduleExactAlarms(): Promise<{ allowed: boolean }>
  /** Open the system ringtone picker; returns the chosen uri + title (or cancelled). */
  pickSound(options: { type: 'alarm' | 'notification'; current?: string }): Promise<{
    uri?: string
    title?: string
    cancelled?: boolean
  }>
  drainPendingAcks(): Promise<{ occurrenceIds: string[] }>
  /** Snoozes made from the native notification, awaiting POST to the server. */
  drainPendingSnoozes(): Promise<{ snoozes: { occurrenceId: string; minutes: number }[] }>
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

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}
