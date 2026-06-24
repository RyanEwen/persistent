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
import { reminderBodyText, type Occurrence } from '@persistent/shared'
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

/** The device-default shade prominence (for reminders set to INHERIT). */
function defaultShadeMinimized(): boolean {
  try {
    const raw = localStorage.getItem('persistent-settings')
    if (raw) {
      const parsed = JSON.parse(raw) as { shadeProminence?: string }
      return parsed.shadeProminence === 'MINIMIZED'
    }
  } catch {
    /* ignore */
  }
  return false
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
    body: reminderBodyText(reminder),
    soundIntervalSeconds: reminder.soundIntervalSeconds ?? 0,
    // ALARM = looping alarm; PERSISTENT = a notification (sounds once).
    alarm,
    // Both persistence levels stay put / re-appear if swiped.
    ongoing: true,
    soundUri: alarm ? chosenSoundUri('alarmSound') : chosenSoundUri('notificationSound'),
    reminderId: occurrence.reminderId,
    // An escalation of a soft reminder can be silenced back to a nag; an inherent
    // ALARM reminder cannot (it has no softer level to fall back to).
    canSilence: reminder.persistence !== 'ALARM' && occurrence.status === 'ESCALATED',
    // Visual shade placement (ignored natively for alarms/escalations).
    shadeProminence: reminder.shadeProminence
  }
}

/** The main alarm plus, if escalation is configured and pending, the escalation alarm. */
function buildAlarms(occurrence: Occurrence): ScheduledAlarm[] {
  const main = toAlarm(occurrence)
  const alarms = [main]
  // Escalation can't ride server push on devices without FCM, so schedule it
  // on-device: a looping alarm at the computed instant, cancelled together with
  // the main alarm on ack/dismiss. Guard that the instant is strictly after the
  // main fire — an escalation must never ring before its reminder does (a server
  // miscompute here once rang the next day's dose ~22h early).
  const escalateAtMs = occurrence.escalateAt ? new Date(occurrence.escalateAt).getTime() : 0
  if (escalateAtMs > main.fireAtMs && occurrence.status !== 'ESCALATED') {
    alarms.push({
      ...main,
      occurrenceId: main.occurrenceId + ESC_SUFFIX,
      fireAtMs: escalateAtMs,
      alarm: true,
      soundIntervalSeconds: 0,
      soundUri: chosenSoundUri('alarmSound'),
      body: main.body ? `${main.body} (escalated)` : 'Escalated',
      // The escalation alarm is always silenceable (escalation never applies to
      // ALARM-persistence reminders), so the user can quiet it and keep nagging.
      canSilence: true
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

/** POST snoozes the user made from the native notification to the server. */
async function drainPendingSnoozes(): Promise<void> {
  const { snoozes } = await AlarmPlugin.drainPendingSnoozes()
  for (const { occurrenceId, minutes } of snoozes) {
    const id = occurrenceId.endsWith(ESC_SUFFIX) ? occurrenceId.slice(0, -ESC_SUFFIX.length) : occurrenceId
    await apiFetch(`/api/occurrences/${id}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ minutes })
    }).catch(() => {})
  }
}

/** POST silences the user made from the native alarm to the server. */
async function drainPendingSilences(): Promise<void> {
  const { occurrenceIds } = await AlarmPlugin.drainPendingSilences()
  // A Silence on the escalation alarm silences the underlying occurrence.
  const baseIds = new Set(occurrenceIds.map((id) => (id.endsWith(ESC_SUFFIX) ? id.slice(0, -ESC_SUFFIX.length) : id)))
  for (const id of baseIds) {
    await apiFetch(`/api/occurrences/${id}/silence`, { method: 'POST' }).catch(() => {})
  }
}

/** Pull the server's occurrence set and replace the device's local alarms. */
export async function syncAlarms(): Promise<void> {
  if (!isNative()) return
  await drainPendingAcks().catch(() => {})
  await drainPendingSnoozes().catch(() => {})
  await drainPendingSilences().catch(() => {})
  const data = await apiFetch<SyncResponse>('/api/sync/occurrences')
  await AlarmPlugin.scheduleAll({ alarms: data.occurrences.flatMap(buildAlarms) })
}

/** If the user tapped a notification, open the app to the main list. */
async function consumePendingNavigation(): Promise<void> {
  const { reminderId } = await AlarmPlugin.consumePendingNavigation()
  if (reminderId) navigateApp('/')
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
  await PushNotifications.requestPermissions().catch(() => {})
  await AlarmPlugin.canScheduleExactAlarms().catch(() => ({ allowed: false }))
  await AlarmPlugin.requestBatteryExemption().catch(() => ({ granted: false }))
  // Without the full-screen-intent grant (Android 14+) the escalation alarm only
  // shows a collapsing heads-up; ask for it so the alarm stays on screen / locked.
  await AlarmPlugin.ensureFullScreenIntent().catch(() => ({ allowed: false }))
}

/**
 * Register for FCM so the server can push fire/escalate/dismiss/sync to this
 * device (the cross-device / ad-hoc / closed-app backup to on-device alarms). The
 * native FcmService acts on pushes even when the bridge is dead; these JS listeners
 * cover token hand-off and the bridge-alive resync.
 *
 * Gated on the server's `fcmEnabled`: calling PushNotifications.register() without
 * Firebase configured hard-crashes the app (a native error JS can't catch), so we
 * only register when the server reports FCM is set up — which means the operator
 * has provisioned Firebase and the APK ships google-services.json.
 */
async function initFcm(): Promise<void> {
  let fcmEnabled = false
  try {
    fcmEnabled = (await apiFetch<{ fcmEnabled: boolean }>('/api/push/config')).fcmEnabled
  } catch {
    return
  }
  if (!fcmEnabled) return

  await PushNotifications.addListener('registration', (token) => {
    void apiFetch('/api/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ kind: 'FCM', token: token.value })
    }).catch(() => {})
  })
  await PushNotifications.addListener('registrationError', () => {
    /* leave on-device alarms as the guarantee; nothing to do */
  })
  // A push arriving while the bridge is alive: the FcmService already applied the
  // self-contained action natively, so just reconcile to the server's truth.
  await PushNotifications.addListener('pushNotificationReceived', () => scheduleResync())
  await PushNotifications.register().catch(() => {})
}

let started = false

/** Call once the user is signed in (no-op on web / if already running). */
export async function initNative(): Promise<void> {
  if (!isNative() || started) return
  started = true
  await requestPermissions()
  // Sync the device-default prominence so the native INHERIT fallback matches the
  // local setting even if it was changed while the app was closed (no-op natively
  // if unchanged, so this won't needlessly re-post).
  await AlarmPlugin.setDefaultShadeProminence({ minimized: defaultShadeMinimized() }).catch(() => {})
  await syncAlarms().catch(() => {})
  await initFcm().catch(() => {})
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
    } else if (event.type === 'silence') {
      // Silenced on another device: stop this device's ringing alarm but keep the
      // notification nagging (down to a soft notification). The resync then sees
      // the occurrence is no longer escalated and won't re-arm its alarm.
      void AlarmPlugin.silence({ occurrenceId: event.occurrenceId }).catch(() => {})
      void AlarmPlugin.silence({ occurrenceId: event.occurrenceId + ESC_SUFFIX }).catch(() => {})
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
