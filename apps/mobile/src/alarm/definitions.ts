/**
 * TypeScript interface for the custom native AlarmPlugin (Android).
 *
 * The web layer schedules on-device exact alarms through this; the Kotlin
 * implementation (android-plugin/) starts a foreground service with an ongoing,
 * full-screen, looping-sound alarm that stops only on explicit "Done".
 */

export interface ScheduledAlarm {
  /** Occurrence id — the alarm's stable key and what we ack against. */
  occurrenceId: string
  /** Epoch milliseconds when the alarm should fire. */
  fireAtMs: number
  title: string
  body: string
  /** Loop the alarm sound every N seconds until acknowledged; 0 = single sound. */
  soundIntervalSeconds: number
  /** Full-screen + ongoing (ALARM/PERSISTENT) vs. a normal notification. */
  alarm: boolean
}

export interface AlarmPluginPlugin {
  /** Schedule (or replace) one exact alarm. */
  schedule(options: ScheduledAlarm): Promise<void>
  /** Replace the entire local alarm set in one call (used after a sync pull). */
  scheduleAll(options: { alarms: ScheduledAlarm[] }): Promise<void>
  /** Cancel a single alarm (e.g. after it's acknowledged elsewhere). */
  cancel(options: { occurrenceId: string }): Promise<void>
  /** Cancel everything (e.g. on sign-out). */
  cancelAll(): Promise<void>
  /** Ask the user to exempt the app from battery optimization (best-effort). */
  requestBatteryExemption(): Promise<{ granted: boolean }>
  /** Whether exact-alarm scheduling is permitted (Android 12+ SCHEDULE_EXACT_ALARM). */
  canScheduleExactAlarms(): Promise<{ allowed: boolean }>
  /**
   * Drain occurrence ids the user confirmed natively (tapped "Done") while the
   * WebView wasn't running. The web layer POSTs the acks (it holds the session
   * cookie) and clears them. The native side already stopped those alarms.
   */
  drainPendingAcks(): Promise<{ occurrenceIds: string[] }>
}
