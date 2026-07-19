/**
 * Local date/time helpers for the reminder editor, plus the schedule a reminder
 * gets when the user creates one *without* picking a date/time.
 *
 * "No date/time" is its own stored schedule kind (`none`) — the server fires it
 * once on creation and never again. It used to be faked as a one-shot at the
 * creation minute, which meant the editor could not tell an unscheduled reminder
 * from one genuinely scheduled for that instant: reopening it showed a date the
 * user never picked, and giving it a real schedule left the immediate firing
 * behind, nagging as "Due" against a schedule that no longer contained it.
 */
import type { Schedule } from '@persistent/shared'

/** Local calendar date as "YYYY-MM-DD" (the shared `calendarDateSchema` shape). */
export function localCalendarDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Local wall-clock time as "HH:mm" (the shared `timeOfDaySchema` shape). */
export function localTimeOfDay(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/**
 * The `{ schedule, startDate }` pair for a reminder with no date/time. `startDate`
 * is only a record of when it was created — an unscheduled reminder fires from its
 * creation instant, not from a calendar date.
 */
export function immediateSchedule(now: Date = new Date()): { schedule: Schedule; startDate: string } {
  return {
    schedule: { kind: 'none', timesOfDay: [] },
    startDate: localCalendarDate(now)
  }
}
