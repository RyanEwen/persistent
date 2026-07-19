/**
 * Human-readable one-liner for a Schedule, used in the reminder list. Times are
 * rendered with the user's 12h/24h preference (pass it from a useSettings call).
 */
import type { Schedule } from '@persistent/shared'
import { formatTimeOfDay, type TimeFormat } from './datetime.js'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function scheduleSummary(schedule: Schedule, timeFormat: TimeFormat): string {
  const times = schedule.timesOfDay.map((t) => formatTimeOfDay(t, timeFormat)).join(', ')
  switch (schedule.kind) {
    case 'none':
      return 'No date or time'
    case 'once':
      return `Once at ${times}`
    case 'daily':
      return `${schedule.skipWeekends ? 'Weekdays' : 'Every day'} at ${times}`
    case 'weekly':
    case 'custom': {
      const days = (schedule.daysOfWeek ?? []).map((d) => DAY_NAMES[d]).join(', ')
      return `${days || 'No days'} at ${times}`
    }
    case 'interval':
      return `Every ${schedule.everyNDays ?? 1} day(s)${schedule.skipWeekends ? ' (weekdays)' : ''} at ${times}`
    default:
      return times
  }
}
