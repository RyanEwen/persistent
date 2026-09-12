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

/** A completed one-time reminder has no future obligation and belongs in History. */
function isFinished(reminder: Reminder): boolean {
  return reminder.schedule.kind === 'once' && reminder.lastOccurrence?.status === 'ACKNOWLEDGED'
}

/**
 * Select reminders shown by Upcoming, ordered by their next fire with paused or
 * exhausted schedules last. An active occurrence owns its reminder while it is
 * on Current, so the reminder cannot appear on both surfaces at once.
 */
export function selectUpcomingReminders(
  reminders: readonly Reminder[],
  activeOccurrences: readonly Pick<Occurrence, 'reminderId'>[],
  now: Date = new Date()
): UpcomingReminder[] {
  const pendingReminderIds = new Set(activeOccurrences.map((occurrence) => occurrence.reminderId))

  return reminders
    .filter((reminder) => !isNote(reminder) && !isFinished(reminder) && !pendingReminderIds.has(reminder.id))
    .map((reminder) => ({ reminder, next: reminderNextFire(reminder, now) }))
    .sort((left, right) => (left.next?.getTime() ?? Infinity) - (right.next?.getTime() ?? Infinity))
}
