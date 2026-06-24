/**
 * Escalation timing: when an unconfirmed occurrence turns into a loud alarm.
 *
 * Pure (luxon only) so it can be unit-tested and shared by the server sweep and
 * the /api/sync endpoint (which hands the instant to the on-device alarm). The
 * one invariant: the escalation instant is always strictly AFTER the firing.
 */
import { DateTime } from 'luxon'

/**
 * When an occurrence escalates to an alarm, or null if no escalation is set.
 * `firedBase` is the fire instant the "after N minutes" threshold counts from
 * (the occurrence's firedAt once fired, else its scheduled time).
 */
export function escalateAtFor(
  firedBase: Date,
  scheduledFor: Date,
  reminder: { escalateAfterMinutes: number | null; escalateAtTime: string | null },
  tz: string
): Date | null {
  if (reminder.escalateAfterMinutes != null) {
    return new Date(firedBase.getTime() + reminder.escalateAfterMinutes * 60_000)
  }
  if (reminder.escalateAtTime != null) {
    return escalationInstant(scheduledFor, reminder.escalateAtTime, tz)
  }
  return null
}

/**
 * Absolute escalation instant: the first "HH:mm" in the user's zone at or after
 * the firing. We anchor on the occurrence's local day, then roll to the next day
 * when that wall-clock time is not strictly after the firing — otherwise a
 * late-night reminder (e.g. fires 23:45, escalates 01:30) would escalate ~22h
 * BEFORE it fires instead of the next morning.
 */
function escalationInstant(scheduledFor: Date, hhmm: string, tz: string): Date {
  const [hs, ms] = hhmm.split(':')
  const hour = Number(hs)
  const minute = Number(ms)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return new Date(8.64e15) // never (far future)
  const fired = DateTime.fromJSDate(scheduledFor, { zone: tz })
  let instant = fired.set({ hour, minute, second: 0, millisecond: 0 })
  if (instant <= fired) instant = instant.plus({ days: 1 })
  return instant.toJSDate()
}
