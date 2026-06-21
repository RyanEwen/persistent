/**
 * Computes a human "fires next" preview for the reminder editor so the firing
 * time is visible at the point of saving. This mirrors the schedule semantics in
 * packages/shared/src/reminders.ts (once/daily/weekly/interval/custom) closely
 * enough for a preview; the server scheduler remains the source of truth.
 */
import type { Schedule, ScheduleKind } from '@persistent/shared'
import { formatTimeOfDay, formatDate, type TimeFormat } from './datetime.js'

export interface SchedulePreviewInput {
  kind: ScheduleKind
  timesOfDay: string[]
  daysOfWeek: number[]
  everyNDays: number
  skipWeekends: boolean
  startDate: string // YYYY-MM-DD (local)
  endDate: string // '' = none
}

const DAY_MS = 86_400_000

/** Parse a YYYY-MM-DD string to local midnight, or null if malformed. */
function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function combine(dayMidnight: Date, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const d = new Date(dayMidnight)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d
}

function sameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function dayMatches(kind: ScheduleKind, cur: Date, start: Date, input: SchedulePreviewInput): boolean {
  const weekday = cur.getDay()
  const weekend = weekday === 0 || weekday === 6
  switch (kind) {
    case 'once':
      return sameDate(cur, start)
    case 'daily':
      return !input.skipWeekends || !weekend
    case 'weekly':
    case 'custom':
      return input.daysOfWeek.includes(weekday)
    case 'interval': {
      const diff = Math.round((cur.getTime() - start.getTime()) / DAY_MS)
      if (diff < 0 || diff % Math.max(1, input.everyNDays) !== 0) return false
      return !input.skipWeekends || !weekend
    }
  }
}

/** The next instant this schedule fires at or after now, or null if none. */
export function nextFire(input: SchedulePreviewInput, now: Date = new Date()): Date | null {
  const start = parseLocalDate(input.startDate)
  if (!start) return null
  const end = input.endDate ? parseLocalDate(input.endDate) : null
  const times = input.timesOfDay
    .map((t) => t)
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .sort()
  if (times.length === 0) return null

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const firstDay = start.getTime() > today.getTime() ? start : today

  for (let i = 0; i <= 366; i++) {
    const cur = new Date(firstDay.getTime() + i * DAY_MS)
    if (end && cur.getTime() > end.getTime() + DAY_MS - 1) break
    if (dayMatches(input.kind, cur, start, input)) {
      for (const t of times) {
        const fire = combine(cur, t)
        if (fire && fire.getTime() >= now.getTime()) return fire
      }
    }
    if (input.kind === 'once') break // only fires on startDate
  }
  return null
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * A short sentence like "Fires today at 2:50 PM — in 3 minutes", or null when
 * the schedule has no upcoming fire (e.g. a one-time date/time already passed).
 */
export function fireSummary(input: SchedulePreviewInput, timeFormat: TimeFormat, now: Date = new Date()): string | null {
  const fire = nextFire(input, now)
  if (!fire) return null

  const time = formatTimeOfDay(hhmm(fire), timeFormat)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const fireDay = new Date(fire)
  fireDay.setHours(0, 0, 0, 0)
  const dayDiff = Math.round((fireDay.getTime() - today.getTime()) / DAY_MS)

  let dayPart: string
  if (dayDiff === 0) dayPart = 'today'
  else if (dayDiff === 1) dayPart = 'tomorrow'
  else dayPart = `on ${formatDate(fire)}`

  const minutes = Math.round((fire.getTime() - now.getTime()) / 60_000)
  let soon = ''
  if (minutes < 60) {
    soon = minutes < 1 ? ' — in under a minute' : ` — in ${minutes} minute${minutes === 1 ? '' : 's'}`
  } else if (minutes < 24 * 60) {
    const hours = Math.round(minutes / 60)
    soon = ` — in ${hours} hour${hours === 1 ? '' : 's'}`
  }

  return `Fires ${dayPart} at ${time}${soon}`
}

// Re-exported for callers building the input from a full Schedule, if needed.
export type { Schedule }
