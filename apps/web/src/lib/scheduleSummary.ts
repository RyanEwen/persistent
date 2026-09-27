/**
 * Human-readable one-liner for a Schedule, used in reminder previews and details. Times are
 * rendered with the user's 12h/24h preference (pass it from a useSettings call).
 */
import type { Reminder, Schedule } from '@persistent/shared'
import { formatDate, formatTimeOfDay, type TimeFormat } from './datetime.js'
import { joinList, ordinal } from './format.js'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "the 1st", "the 1st and 15th", "the last day", "the 1st and the last day". */
export function monthlyDaysText(schedule: Schedule): string {
  const days = [...(schedule.daysOfMonth ?? [])].sort((a, b) => a - b).map(ordinal)
  // "the last day" carries its own article, so it joins as a whole phrase and the
  // shared leading "the" is only added when a numbered day starts the run.
  const parts = schedule.lastDayOfMonth ? [...days, 'the last day'] : days
  if (parts.length === 0) return 'no days'
  return days.length ? `the ${joinList(parts)}` : joinList(parts)
}

export function scheduleSummary(schedule: Schedule, timeFormat: TimeFormat): string {
  const times = schedule.timesOfDay.map((t) => formatTimeOfDay(t, timeFormat)).join(', ')
  switch (schedule.kind) {
    case 'none':
      return 'No date or time'
    case 'never':
      return 'Never notifies you — a note'
    case 'once':
      return `Once at ${times}`
    case 'daily':
      return `${schedule.skipWeekends ? 'Weekdays' : 'Every day'} at ${times}`
    case 'weekly':
    case 'custom': {
      const days = (schedule.daysOfWeek ?? []).map((d) => DAY_NAMES[d]).join(', ')
      return `${days || 'No days'} at ${times}`
    }
    case 'monthly':
      return `Monthly on ${monthlyDaysText(schedule)} at ${times}`
    case 'interval':
      return `Every ${schedule.everyNDays ?? 1} day(s)${schedule.skipWeekends ? ' (weekdays)' : ''} at ${times}`
    default:
      return times
  }
}

/**
 * Reading-view schedule line. A one-time schedule needs its calendar date, which
 * the generic recurrence summary cannot supply from Schedule alone. Interpret
 * startDate as a calendar date, not as an instant in the browser's time zone.
 */
export function reminderScheduleLine(
  reminder: Pick<Reminder, 'schedule' | 'startDate'>,
  timeFormat: TimeFormat
): string {
  const { schedule, startDate } = reminder
  if (schedule.kind !== 'once') return scheduleSummary(schedule, timeFormat)

  const date = formatDate(`${startDate}T12:00:00Z`, 'UTC')
  const time = schedule.timesOfDay.map((value) => formatTimeOfDay(value, timeFormat)).join(', ')
  if (!date) return scheduleSummary(schedule, timeFormat)
  return time ? `${date} at ${time}` : date
}
