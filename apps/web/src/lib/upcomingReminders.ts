/**
 * Shared selection policy for surfaces that summarize Upcoming. Keeping this
 * beside the schedule preview prevents the Windows widget from growing its own
 * interpretation of notes, completed one-shots, or active occurrences.
 */
import type { Occurrence, Reminder } from '@persistent/shared'
import { isNote } from './notes.js'
import { reminderNextFire } from './schedule-preview.js'

export interface UpcomingReminder {
  reminder: Reminder
  next: Date | null
}

/** A confirmed single firing has no future obligation and belongs in History. */
function isFinished(reminder: Reminder): boolean {
  return (reminder.schedule.kind === 'once' || reminder.schedule.kind === 'none') &&
    reminder.lastOccurrence?.status === 'ACKNOWLEDGED'
}

/**
 * Select reminders shown by Upcoming, ordered by their next fire with paused or
 * exhausted schedules last. An active occurrence owns its reminder while it is
 * on Current, so the reminder cannot appear on both surfaces at once.
 * `nextById` supplies server-calculated instants for received owner-zone schedules.
 */
export function selectUpcomingReminders(
  reminders: readonly Reminder[],
  activeOccurrences: readonly Pick<Occurrence, 'reminderId'>[],
  now: Date = new Date(),
  nextById?: ReadonlyMap<string, Date | null>
): UpcomingReminder[] {
  const pendingReminderIds = new Set(activeOccurrences.map((occurrence) => occurrence.reminderId))

  return reminders
    .filter((reminder) => !isNote(reminder) && !isFinished(reminder) && !pendingReminderIds.has(reminder.id))
    .map((reminder) => ({
      reminder,
      // Received schedules belong to their owner's time zone. Their exact next
      // instant comes from the server instead of this device's schedule preview.
      next: nextById?.has(reminder.id) ? nextById.get(reminder.id) ?? null : reminderNextFire(reminder, now)
    }))
    .sort((left, right) => (left.next?.getTime() ?? Infinity) - (right.next?.getTime() ?? Infinity))
}
