/**
 * Native sync: keep on-device exact alarms in step with the server. On the
 * native Android client this schedules the alarms that actually fire (offline,
 * full-screen, looping sound), drains acks the user made natively, and — for
 * live updates — re-syncs whenever a WS event says reminders/occurrences
 * changed, plus on app resume. No-op on the web.
 *
 * This is the JS half of the "device-scheduled + server backup" model and is
 * bundled into the web app (what Capacitor loads), so it must guard every native
 * call behind isNative().
 */
import { App } from '@capacitor/app'
import { PushNotifications } from '@capacitor/push-notifications'
import type { Occurrence } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { subscribeWs } from '../lib/wsClient.js'
import { AlarmPlugin, isNative, type ScheduledAlarm } from './alarmBridge.js'
import { navigateApp } from './navTo.js'

interface SyncResponse {
  serverTime: string
  timeZone: string
  occurrences: Occurrence[]
}

/** Read the user's chosen sound URIs from the persisted settings (no React here). */
function chosenSoundUri(kind: 'alarmSound' | 'notificationSound'): string {
  try {
    const raw = localStorage.getItem('persistent-settings')
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, { uri?: string }>
      return parsed[kind]?.uri ?? ''
    }
  } catch {
    /* ignore */
  }
  return ''
}

// The escalation alarm is a second device alarm keyed off the occurrence id with
// this suffix, so it can be scheduled/cancelled/acked alongside the main one.
const ESC_SUFFIX = '::esc'

function toAlarm(occurrence: Occurrence): ScheduledAlarm {
  const { reminder } = occurrence
  const fireAt = occurrence.status === 'SNOOZED' && occurrence.snoozedUntil ? occurrence.snoozedUntil : occurrence.scheduledFor
  // ALARM persistence always rings; an already-escalated occurrence also rings.
  const alarm = reminder.persistence === 'ALARM' || occurrence.status === 'ESCALATED'
  return {
    occurrenceId: occurrence.id,
    fireAtMs: new Date(fireAt).getTime(),
    title: reminder.title,
    body: reminder.details ?? '',
    soundIntervalSeconds: reminder.soundIntervalSeconds ?? 0,
    // ALARM = looping alarm; PERSISTENT = a notification (sounds once).
    alarm,
    // Both persistence levels stay put / re-appear if swiped.
    ongoing: true,
    soundUri: alarm ? chosenSoundUri('alarmSound') : chosenSoundUri('notificationSound'),
    reminderId: occurrence.reminderId
  }
}

/** The main alarm plus, if escalation is configured and pending, the escalation alarm. */
function buildAlarms(occurrence: Occurrence): ScheduledAlarm[] {
  const main = toAlarm(occurrence)
  const alarms = [main]
  // Escalation can't ride server push on devices without FCM, so schedule it
  // on-device: a looping alarm at the computed instant, cancelled together with
  // the main alarm on ack/dismiss.
  if (occurrence.escalateAt && occurrence.status !== 'ESCALATED') {
    alarms.push({
      ...main,
      occurrenceId: main.occurrenceId + ESC_SUFFIX,
      fireAtMs: new Date(occurrence.escalateAt).getTime(),
      alarm: true,
      soundIntervalSeconds: 0,
      soundUri: chosenSoundUri('alarmSound'),
      body: main.body ? `${main.body} (escalated)` : 'Escalated'
    })
  }
  return alarms
}

/** POST any acks the user confirmed natively while the WebView wasn't running. */
async function drainPendingAcks(): Promise<void> {
  const { occurrenceIds } = await AlarmPlugin.drainPendingAcks()
  // A Done on the escalation alarm acks the underlying occurrence.
  const baseIds = new Set(occurrenceIds.map((id) => (id.endsWith(ESC_SUFFIX) ? id.slice(0, -ESC_SUFFIX.length) : id)))
  for (const id of baseIds) {
    await apiFetch(`/api/occurrences/${id}/ack`, { method: 'POST' }).catch(() => {})
  }
}

/** Pull the server's occurrence set and replace the device's local alarms. */
export async function syncAlarms(): Promise<void> {
  if (!isNative()) return
  await drainPendingAcks().catch(() => {})
  const data = await apiFetch<SyncResponse>('/api/sync/occurrences')
  await AlarmPlugin.scheduleAll({ alarms: data.occurrences.flatMap(buildAlarms) })
}

/** If the user tapped a notification, navigate to that reminder's editor. */
async function consumePendingNavigation(): Promise<void> {
  const { reminderId } = await AlarmPlugin.consumePendingNavigation()
  if (reminderId) navigateApp(`/reminders/${reminderId}`)
}

// Coalesce bursts of WS events / resumes into a single re-sync.
let resyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleResync(): void {
  if (resyncTimer) return
  resyncTimer = setTimeout(() => {
    resyncTimer = null
    void syncAlarms().catch(() => {})
  }, 500)
}

async function requestPermissions(): Promise<void> {
  // POST_NOTIFICATIONS (Android 13+) — without it the alarm notification is
  // silently dropped. requestPermissions() drives the runtime prompt without
  // touching Firebase.
  //
  // NOTE: we deliberately do NOT call PushNotifications.register() here. That
  // initializes FCM, which hard-crashes the app when google-services.json is
  // absent (a native error JS can't catch). FCM is only the cross-device /
  // escalation backup; on-device exact alarms cover firing. Wire register() back
  // in (guarded) once Firebase is configured.
  await PushNotifications.requestPermissions().catch(() => {})
  await AlarmPlugin.canScheduleExactAlarms().catch(() => ({ allowed: false }))
  await AlarmPlugin.requestBatteryExemption().catch(() => ({ granted: false }))
}

let started = false

/** Call once the user is signed in (no-op on web / if already running). */
export async function initNative(): Promise<void> {
  if (!isNative() || started) return
  started = true
  await requestPermissions()
  await syncAlarms().catch(() => {})
  await consumePendingNavigation().catch(() => {})

  // Live updates: react to the server's WS stream.
  subscribeWs((event) => {
    if (event.type === 'dismiss') {
      // Ack/snooze (from any device or the in-app Done button) clears the alarm:
      // stop the on-device sound/notification for that occurrence immediately,
      // including its escalation alarm.
      void AlarmPlugin.cancel({ occurrenceId: event.occurrenceId }).catch(() => {})
      void AlarmPlugin.cancel({ occurrenceId: event.occurrenceId + ESC_SUFFIX }).catch(() => {})
      scheduleResync()
    } else if (
      event.type === 'reminder.changed' ||
      event.type === 'occurrence.changed' ||
      event.type === 'occurrence.fired'
    ) {
      scheduleResync()
    }
  })
  void App.addListener('resume', () => {
    void consumePendingNavigation().catch(() => {})
    scheduleResync()
  })
}
