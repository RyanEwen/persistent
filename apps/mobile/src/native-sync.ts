/**
 * Native sync: keep on-device alarms in step with the server (the source of
 * truth). Pulls upcoming occurrences and schedules exact local alarms so they
 * fire offline, registers for FCM, and re-syncs on app resume + push.
 *
 * This realizes the "device-scheduled + server backup" model (docs/alarm-architecture.md):
 * the device owns firing; FCM pushes are just a nudge to re-sync or fire ad-hoc.
 */
import { App } from '@capacitor/app'
import { PushNotifications } from '@capacitor/push-notifications'
import { AlarmPlugin, isNative } from './alarm/index.js'
import type { ScheduledAlarm } from './alarm/definitions.js'

/** Where the hosted API lives. Override at build time for your deployment. */
const API_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''

interface SyncOccurrence {
  id: string
  scheduledFor: string
  status: string
  reminder: {
    title: string
    details: string | null
    persistence: 'GENTLE' | 'PERSISTENT' | 'ALARM'
    soundIntervalSeconds: number | null
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers }
  })
  if (!response.ok) throw new Error(`API ${path} failed: ${response.status}`)
  return (await response.json()) as T
}

function toAlarm(occurrence: SyncOccurrence): ScheduledAlarm {
  const { reminder } = occurrence
  return {
    occurrenceId: occurrence.id,
    fireAtMs: new Date(occurrence.scheduledFor).getTime(),
    title: reminder.title,
    body: reminder.details ?? '',
    soundIntervalSeconds: reminder.soundIntervalSeconds ?? 0,
    alarm: reminder.persistence === 'ALARM' || reminder.persistence === 'PERSISTENT'
  }
}

/** POST any acks the user confirmed natively while the WebView was not running. */
async function drainPendingAcks(): Promise<void> {
  if (!isNative()) return
  const { occurrenceIds } = await AlarmPlugin.drainPendingAcks()
  for (const occurrenceId of occurrenceIds) {
    await api(`/api/occurrences/${occurrenceId}/ack`, { method: 'POST' }).catch(() => {})
  }
}

/** Pull the server's occurrence set and replace the device's local alarms. */
export async function syncAlarms(): Promise<void> {
  if (!isNative()) return
  await drainPendingAcks()
  const data = await api<{ occurrences: SyncOccurrence[] }>('/api/sync/occurrences')
  // Only schedule things still needing attention and not already past + handled.
  const alarms = data.occurrences
    .filter((o) => o.status === 'PENDING' || o.status === 'FIRED' || o.status === 'SNOOZED' || o.status === 'ESCALATED')
    .map(toAlarm)
  await AlarmPlugin.scheduleAll({ alarms })
}

/** Acknowledge an occurrence (called by the native Done action via the bridge). */
export async function ackOccurrence(occurrenceId: string): Promise<void> {
  await api(`/api/occurrences/${occurrenceId}/ack`, { method: 'POST' })
  await AlarmPlugin.cancel({ occurrenceId })
}

async function registerPush(): Promise<void> {
  if (!isNative()) return
  const status = await PushNotifications.requestPermissions()
  if (status.receive !== 'granted') return

  PushNotifications.addListener('registration', (token) => {
    void api('/api/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ kind: 'FCM', token: token.value, deviceLabel: 'Android' })
    }).catch(() => {})
  })

  // A data push is a nudge: re-sync (covers new/changed/escalated reminders).
  PushNotifications.addListener('pushNotificationReceived', () => {
    void syncAlarms().catch(() => {})
  })

  await PushNotifications.register()
}

/** Call once at startup (inside the wrapped web app) when running natively. */
export async function initNative(): Promise<void> {
  if (!isNative()) return
  await AlarmPlugin.canScheduleExactAlarms().catch(() => ({ allowed: false }))
  await AlarmPlugin.requestBatteryExemption().catch(() => ({ granted: false }))
  await registerPush().catch(() => {})
  await syncAlarms().catch(() => {})

  // Re-sync whenever the app comes to the foreground.
  App.addListener('resume', () => {
    void syncAlarms().catch(() => {})
  })
}
