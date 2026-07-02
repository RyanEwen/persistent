/**
 * Expand an occurrence into the concrete on-device alarms the Android client
 * should arm. This is the single source of truth for the occurrence->alarm
 * transform: both the JS bridge (`nativeSync.ts`) and the native background sync
 * worker consume this server-computed list, so neither reimplements it.
 *
 * Mirrors what the device needs: a main fire alarm plus, when escalation is
 * configured and still pending, a second escalation alarm at the computed instant.
 * The device-local sound URI is intentionally omitted — the server emits
 * `soundKind` and each consumer fills the tone from local settings.
 */
import type { Reminder } from '@prisma/client'
import { type DeviceAlarm, ESC_SUFFIX } from '@persistent/shared'
import { notificationBody } from './notification-format.js'

interface OccurrenceForAlarm {
  id: string
  reminderId: string
  status: string
  scheduledFor: Date
  snoozedUntil: Date | null
  reminder: Reminder
}

/**
 * @param escalateAt the occurrence's escalation instant (already computed and
 *   snooze-/silence-gated by the caller), or null when no future escalation applies.
 */
export function buildDeviceAlarms(occurrence: OccurrenceForAlarm, escalateAt: Date | null): DeviceAlarm[] {
  const { reminder } = occurrence
  // A snoozed occurrence fires again when the snooze ends; everything else at its
  // scheduled time (already-fired ones sit in the past and ring immediately).
  const fireAtMs = (occurrence.status === 'SNOOZED' && occurrence.snoozedUntil
    ? occurrence.snoozedUntil
    : occurrence.scheduledFor
  ).getTime()
  // ALARM persistence always rings; an already-escalated occurrence also rings.
  const alarm = reminder.persistence === 'ALARM' || occurrence.status === 'ESCALATED'
  const body = notificationBody(reminder)

  const main: DeviceAlarm = {
    occurrenceId: occurrence.id,
    fireAtMs,
    title: reminder.title,
    body,
    soundIntervalSeconds: reminder.soundIntervalSeconds ?? 0,
    alarm,
    ongoing: true,
    // An escalation of a soft reminder can be silenced back to a nag; an inherent
    // ALARM reminder cannot (no softer level to fall back to).
    canSilence: reminder.persistence !== 'ALARM' && occurrence.status === 'ESCALATED',
    soundKind: alarm ? 'alarm' : 'notification',
    reminderId: occurrence.reminderId,
    shadeProminence: reminder.shadeProminence
  }
  const alarms: DeviceAlarm[] = [main]

  // Escalation can't ride server push on devices without FCM, so schedule it
  // on-device: a looping alarm at the computed instant, cancelled together with the
  // main alarm on ack/dismiss. Guard that the instant is strictly after the main
  // fire — an escalation must never ring before its reminder does.
  const escalateAtMs = escalateAt ? escalateAt.getTime() : 0
  if (escalateAtMs > fireAtMs && occurrence.status !== 'ESCALATED') {
    alarms.push({
      ...main,
      occurrenceId: main.occurrenceId + ESC_SUFFIX,
      fireAtMs: escalateAtMs,
      alarm: true,
      soundIntervalSeconds: 0,
      soundKind: 'alarm',
      body: main.body ? `${main.body} (escalated)` : 'Escalated',
      // The escalation alarm is always silenceable (escalation never applies to an
      // ALARM-persistence reminder), so the user can quiet it and keep nagging.
      canSilence: true
    })
  }
  return alarms
}
