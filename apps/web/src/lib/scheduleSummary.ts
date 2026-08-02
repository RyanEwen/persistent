/**
 * Human-readable one-liner for a Schedule, used in the reminder list. Times are
 * rendered with the user's 12h/24h preference (pass it from a useSettings call).
 */
import type { Schedule } from '@persistent/shared'
import { formatTimeOfDay, type TimeFormat } from './datetime.js'
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
