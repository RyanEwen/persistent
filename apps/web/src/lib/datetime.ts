/**
 * Date/time formatting honoring the user's 12h/24h preference (see
 * settings/useSettings.tsx). Use these everywhere a date or time is shown so the
 * format stays consistent — never call toLocaleString/Date formatting directly
 * in components. Times never include seconds.
 */
export type TimeFormat = '12h' | '24h'

/** The locale's natural default, used when the user hasn't picked one. */
export function detectTimeFormat(): TimeFormat {
  try {
    // `hour12`/`hourCycle` are only resolved when an hour field is requested; an
    // optionless DateTimeFormat leaves them undefined (which wrongly read as 24h).
    const resolved = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
    if (resolved.hour12 !== undefined) return resolved.hour12 ? '12h' : '24h'
    return resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12' ? '12h' : '24h'
  } catch {
    return '12h'
  }
}

/** Format a "HH:mm" time-of-day string, e.g. "08:05" -> "8:05 AM" or "08:05". */
export function formatTimeOfDay(hhmm: string, format: TimeFormat): string {
  const [rawHours, rawMinutes] = hhmm.split(':')
  const hours = Number(rawHours)
  const minutes = Number(rawMinutes)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return hhmm
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: format === '12h'
  }).format(date)
}

/** Format an instant (ISO string or Date) as date + time, no seconds. */
export function formatDateTime(value: string | Date, format: TimeFormat): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: format === '12h'
  }).format(date)
}

/** Format an instant as date only. */
export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}
