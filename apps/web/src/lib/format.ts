/** Small display formatters for enum-ish values surfaced in the UI. */
import type { ReminderType } from '@persistent/shared'

const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  NONE: 'Reminder',
  // Not "Todo": the thing that distinguishes this type is the checklist, and the
  // label has to read as one in the picker and in the icon's aria-label alike.
  TODO: 'Checklist',
  MEDICATION: 'Medication'
}

/** The user-facing name of a reminder type, for pickers, icons and copy. */
export function reminderTypeLabel(type: ReminderType): string {
  return REMINDER_TYPE_LABELS[type]
}

/** "MEDICATION" -> "Medication", "NONE" -> "None". */
export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 22 -> "22nd". For days of the month. */
export function ordinal(value: number): string {
  // 11/12/13 take "th" despite ending in 1/2/3, so the teens are checked first.
  const teen = value % 100
  if (teen >= 11 && teen <= 13) return `${value}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th'
  return `${value}${suffix}`
}

/** ["1st"] -> "1st"; ["1st","15th"] -> "1st and 15th"; three or more -> "a, b and c". */
export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
