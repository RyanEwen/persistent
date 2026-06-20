/**
 * Human-readable one-liner for a Schedule, used in the reminder list.
 */
import type { Schedule } from '@persistent/shared'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function scheduleSummary(schedule: Schedule): string {
  const times = schedule.timesOfDay.join(', ')
  switch (schedule.kind) {
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
