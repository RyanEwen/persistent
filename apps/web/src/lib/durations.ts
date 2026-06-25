/**
 * Duration presets + unit conversion shared by the reminder editor (re-sound,
 * escalation "how late") and the snooze dialogs. Everything is stored in minutes;
 * the custom editor lets the user pick a unit.
 */
export interface DurationPreset {
  label: string
  minutes: number
}

/** Presets for "re-sound" and "how late". */
export const DURATION_PRESETS: DurationPreset[] = [
  { label: '5 min', minutes: 5 },
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '1 week', minutes: 10080 },
  { label: '2 weeks', minutes: 20160 },
  { label: '1 month', minutes: 43200 }
]

/** Presets offered when snoozing. */
export const SNOOZE_PRESETS: DurationPreset[] = [
  { label: '5 min', minutes: 5 },
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '3 hr', minutes: 180 },
  { label: '1 day', minutes: 1440 }
]

export interface DurationUnit {
  label: string
  minutes: number
}

/** Units for the custom duration editor (approximate months/years). */
export const DURATION_UNITS: DurationUnit[] = [
  { label: 'mins', minutes: 1 },
  { label: 'hrs', minutes: 60 },
  { label: 'days', minutes: 1440 },
  { label: 'months', minutes: 43200 },
  { label: 'years', minutes: 525600 }
]

/** Split a minute total into the largest whole unit (for the custom editor). */
export function minutesToCustom(total: number): { value: number; unit: string } {
  for (const u of [...DURATION_UNITS].reverse()) {
    if (total % u.minutes === 0) return { value: total / u.minutes, unit: u.label }
  }
  return { value: total, unit: 'mins' }
}

export function customToMinutes(value: number, unit: string): number {
  const minutes = DURATION_UNITS.find((x) => x.label === unit)?.minutes ?? 1
  return Math.max(1, Math.round(value * minutes))
}

/**
 * Minutes from now until the next occurrence of a wall-clock time (`HH:MM`). If
 * that time has already passed today it rolls to tomorrow. Clamped to the snooze
 * ceiling (1 day) with a 1-minute floor so the result is always a valid snooze.
 */
export function minutesUntilTime(hhmm: string, from: Date = new Date()): number {
  const parts = hhmm.split(':')
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (Number.isNaN(h) || Number.isNaN(m)) return 1
  const target = new Date(from)
  target.setHours(h, m, 0, 0)
  if (target.getTime() <= from.getTime()) target.setDate(target.getDate() + 1)
  const minutes = Math.round((target.getTime() - from.getTime()) / 60_000)
  return Math.min(1440, Math.max(1, minutes))
}

/** Compact label for an arbitrary minute total. */
export function formatDurationMinutes(total: number): string {
  const preset = DURATION_PRESETS.find((p) => p.minutes === total)
  if (preset) return preset.label
  const { value, unit } = minutesToCustom(total)
  return `${value} ${unit}`
}
