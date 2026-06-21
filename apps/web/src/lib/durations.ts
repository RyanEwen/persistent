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

/** Compact label for an arbitrary minute total. */
export function formatDurationMinutes(total: number): string {
  const preset = DURATION_PRESETS.find((p) => p.minutes === total)
  if (preset) return preset.label
  const { value, unit } = minutesToCustom(total)
  return `${value} ${unit}`
}
