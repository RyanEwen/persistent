/**
 * Timezone-correct expansion of a reminder Schedule into firing instants.
 *
 * Times-of-day are interpreted in the user's IANA time zone (DST-correct via
 * luxon), so "08:00 daily" lands at 08:00 local even across clock changes.
 * Returns UTC Date instants within the half-open window [from, to).
 */
import { DateTime } from 'luxon'
import type { Schedule } from '@persistent/shared'

export interface ExpandInput {
  schedule: Schedule
  /** Calendar date YYYY-MM-DD, in the user's zone. */
  startDate: string
  /** Calendar date YYYY-MM-DD, in the user's zone, inclusive. Null = open-ended. */
  endDate: string | null
  timeZone: string
  from: Date
  to: Date
}

/** Luxon weekday is 1=Mon..7=Sun; our schedule uses 0=Sun..6=Sat. */
function luxonWeekdayToSun0(weekday: number): number {
  return weekday % 7
}

export function expandSchedule(input: ExpandInput): Date[] {
  const { schedule, startDate, endDate, timeZone, from, to } = input
  const zone = timeZone || 'UTC'

  const anchor = DateTime.fromISO(startDate, { zone }).startOf('day')
  if (!anchor.isValid) return []
  const end = endDate ? DateTime.fromISO(endDate, { zone }).endOf('day') : null

  const windowStart = DateTime.fromJSDate(from, { zone })
  const windowEnd = DateTime.fromJSDate(to, { zone })

  // Start iterating from the later of the schedule anchor and the window start.
  let cursor: DateTime = anchor.startOf('day')
  const iterFromDay = windowStart.startOf('day')
  if (iterFromDay > cursor) cursor = iterFromDay

  const results: Date[] = []
  // Hard cap to avoid runaway loops on a pathological window.
  for (let guard = 0; guard < 1000 && cursor <= windowEnd; guard += 1, cursor = cursor.plus({ days: 1 })) {
    if (end && cursor.startOf('day') > end) break
    if (!isActiveDay(cursor, anchor, schedule)) continue

    for (const time of schedule.timesOfDay) {
      const [hour, minute] = time.split(':').map((part) => Number.parseInt(part, 10))
      const fireAt = cursor.set({ hour, minute, second: 0, millisecond: 0 })
      if (!fireAt.isValid) continue
      const jsDate = fireAt.toJSDate()
      if (jsDate >= from && jsDate < to) {
        results.push(jsDate)
      }
    }

    if (schedule.kind === 'once') break // a one-shot only fires on its start day
  }

  return results.sort((a, b) => a.getTime() - b.getTime())
}

function isActiveDay(day: DateTime, anchor: DateTime, schedule: Schedule): boolean {
  const weekdaySun0 = luxonWeekdayToSun0(day.weekday)
  const isWeekend = weekdaySun0 === 0 || weekdaySun0 === 6

  switch (schedule.kind) {
    case 'once':
      return day.hasSame(anchor, 'day')
    case 'daily':
      return !(schedule.skipWeekends && isWeekend)
    case 'weekly':
    case 'custom':
      return (schedule.daysOfWeek ?? []).includes(weekdaySun0)
    case 'interval': {
      const every = schedule.everyNDays ?? 1
      const days = Math.round(day.startOf('day').diff(anchor.startOf('day'), 'days').days)
      if (days < 0 || days % every !== 0) return false
      return !(schedule.skipWeekends && isWeekend)
    }
    default:
      return false
  }
}
