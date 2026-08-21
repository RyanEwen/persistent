/**
 * Expand an occurrence into the concrete on-device alarms the Android client
 * should arm. This is the single source of truth for the occurrence->alarm
 * transform: both the JS bridge (`nativeSync.ts`) and the native background sync
 * worker consume this server-computed list, so neither reimplements it.
 *
 * Mirrors what the device needs: a main fire alarm plus, when escalation is
 * configured and still pending, a second escalation alarm at the computed instant.
 *
 * Sound is split. The *device's* tones are per-device settings the server has never
 * seen, so it emits `soundKind` and the consumer fills the URI locally. The
 * *reminder's* own tones are reminder fields, so they are sent (`sound`/`nagSound`)
 * — still as a choice to resolve rather than a URI to trust, since it was picked on
 * whichever device the user set it from.
 */
import type { Reminder } from '@prisma/client'
import { type DeviceAlarm, ESC_SUFFIX } from '@persistent/shared'
import { notificationBody } from './notification-format.js'
import { firingSounds } from './reminder-sounds.js'
import { toCheckedItemIds } from './serializers.js'

interface OccurrenceForAlarm {
  id: string
  reminderId: string
  status: string
  scheduledFor: Date
  snoozedUntil: Date | null
  /** When this firing escalated, if it has. Survives a snooze — see `ringing` below. */
  escalatedAt: Date | null
  /** Set once the user has silenced the escalation: it must never ring again. */
  escalationSilencedAt: Date | null
  /** This firing's checklist ticks (loose JSON column) — ticked items drop off the body. */
  checkedItems: unknown
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
  // Whether the device should RING at `fireAtMs` rather than post a soft nag.
  //
  // "Has this firing escalated?" is asked of `escalatedAt`, not of the status, because
  // **snoozing an alarm snoozes the alarm** (docs/notification-behavior.md §3): the
  // status is SNOOZED for the duration, but what comes back is the alarm that was
  // snoozed, not a nag. Reading the status alone re-armed a soft notification and
  // dropped the escalation alarm (its instant is behind the snooze, so the guard
  // below skips it) — a snooze silently de-escalated the firing on-device until the
  // server's 60s sweep pushed the escalation back.
  //
  // A snooze long enough to outlast a *pending* escalation ends in one too, for the
  // same reason and by the same rule the server sweep applies: `escalateAt` is
  // anchored to the first fire and never reset by a snooze, so once it is behind the
  // return time the firing returns escalated. Only a snoozed firing can be in that
  // position — an escalation instant is always strictly after the fire it belongs to.
  //
  // Silence is what takes the ring away for good: it says "stop yelling, keep
  // reminding me", so it outranks both.
  const snoozed = occurrence.status === 'SNOOZED' && occurrence.snoozedUntil != null
  const escalationDueOnReturn = snoozed && escalateAt != null && escalateAt.getTime() <= fireAtMs
  const ringing =
    occurrence.escalationSilencedAt == null &&
    (occurrence.status === 'ESCALATED' || occurrence.escalatedAt != null || escalationDueOnReturn)
  // ALARM persistence always rings; so does anything currently escalated.
  const alarm = reminder.persistence === 'ALARM' || ringing
  // Only the unticked checklist items: the device re-pulls this list whenever a tick
  // lands (the `/check` sync nudge), and re-posts the nag when the text drifts.
  const body = notificationBody(reminder, toCheckedItemIds(occurrence.checkedItems))

  const main: DeviceAlarm = {
    occurrenceId: occurrence.id,
    fireAtMs,
    title: reminder.title,
    body,
    soundIntervalSeconds: reminder.soundIntervalSeconds ?? 0,
    alarm,
    ongoing: true,
    // An escalation of a soft reminder can be silenced back to a nag; an inherent
    // ALARM reminder cannot (no softer level to fall back to). Tracks `ringing`, so
    // an alarm returning from a snooze can still be quietened — offering the ring
    // without the way out of it would be the worse half of the bug above.
    canSilence: reminder.persistence !== 'ALARM' && ringing,
    soundKind: alarm ? 'alarm' : 'notification',
    reminderId: occurrence.reminderId,
    shadeProminence: reminder.shadeProminence,
    ...firingSounds(reminder.sounds, alarm)
  }
  const alarms: DeviceAlarm[] = [main]

  // Escalation can't ride server push on devices without FCM, so schedule it
  // on-device: a looping alarm at the computed instant, cancelled together with the
  // main alarm on ack/dismiss. Guard that the instant is strictly after the main
  // fire — an escalation must never ring before its reminder does.
  // Nothing already ringing needs one: the main alarm above IS the escalation.
  const escalateAtMs = escalateAt ? escalateAt.getTime() : 0
  if (escalateAtMs > fireAtMs && !ringing) {
    alarms.push({
      ...main,
      occurrenceId: main.occurrenceId + ESC_SUFFIX,
      fireAtMs: escalateAtMs,
      alarm: true,
      soundIntervalSeconds: 0,
      soundKind: 'alarm',
      // Re-asked rather than inherited through the spread: the main alarm above is
      // the *soft* form of this firing (nothing already ringing gets an escalation),
      // so it carries the reminder's notification tone and its nag tone. An
      // escalation rings, so it takes the alarm tone and no nag tone at all.
      ...firingSounds(reminder.sounds, true),
      body: main.body ? `${main.body} (escalated)` : 'Escalated',
      // The escalation alarm is always silenceable (escalation never applies to an
      // ALARM-persistence reminder), so the user can quiet it and keep nagging.
      canSilence: true
    })
  }
  return alarms
}
