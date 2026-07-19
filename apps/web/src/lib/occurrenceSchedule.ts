/**
 * Detects an occurrence its reminder's current schedule no longer covers.
 *
 * The server deliberately keeps a FIRED occurrence alive across an edit — only
 * Done clears a firing (docs/notification-behavior.md §1), so that rescheduling a
 * reminder can never silently erase a dose you didn't take. The side effect is
 * that moving a reminder's start date into the future leaves the earlier firing
 * nagging as "Due", which reads as a bug: the reminder now claims to start next
 * week, yet something is due today.
 *
 * This is the UI's way of telling those two cases apart. The occurrence still
 * nags and still needs an explicit action — it is just labelled honestly as
 * belonging to a date the reminder no longer covers.
 */
import type { Occurrence, Reminder } from '@persistent/shared'

/** Calendar date ("YYYY-MM-DD") of an instant, in the viewer's local zone. */
function localDateKey(value: string): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * True when the occurrence's date falls outside the reminder's current
 * start/end window — i.e. the reminder's definition would no longer produce it.
 *
 * Deliberately compares dates only, not times of day: retiming a reminder whose
 * 09:00 dose is still unconfirmed must keep that dose nagging, because the day it
 * belongs to is still covered. Only a window that has moved past the firing
 * entirely makes it orphaned.
 */
export function isOutsideReminderWindow(reminder: Reminder, occurrence: Occurrence): boolean {
  const day = localDateKey(occurrence.scheduledFor)
  if (day < reminder.startDate) return true
  if (reminder.endDate && day > reminder.endDate) return true
  return false
}
