/** Small display formatters for enum-ish values surfaced in the UI. */

/** "MEDICATION" -> "Medication", "NONE" -> "None". */
export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}
