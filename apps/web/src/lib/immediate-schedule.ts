/**
 * The schedule a reminder gets when the user creates one *without* picking a
 * date/time ("Remind me now" in the editor).
 *
 * There is no unscheduled reminder in the data model — every reminder has a
 * schedule — so "no date/time" is materialized as a one-shot at the current local
 * minute. That instant has usually already slipped into the past by the time the
 * request lands (minute truncation + latency), which is exactly the case the
 * server's one-shot back-fill window and `firesRightAway` are built for, so the
 * reminder nags immediately.
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

/** The `{ schedule, startDate }` pair for a reminder that should fire right away. */
export function immediateSchedule(now: Date = new Date()): { schedule: Schedule; startDate: string } {
  return {
    schedule: { kind: 'once', timesOfDay: [localTimeOfDay(now)] },
    startDate: localCalendarDate(now)
  }
}
