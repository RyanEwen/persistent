/**
 * Centralizes turning a reminder/occurrence into notification copy, so every
 * channel (web push, FCM, escalation email) shows consistent text.
 */
import type { Reminder } from '@prisma/client'
import type { MedicationData } from '@persistent/shared'

/** One medication -> "Ibuprofen 200 mg" (any missing pieces are dropped). */
function formatMedication(med: MedicationData): string {
  return [med.name, [med.quantity, med.unit].filter(Boolean).join(' ')].filter(Boolean).join(' ')
}

export function notificationTitle(reminder: Pick<Reminder, 'title'>): string {
  return reminder.title
}

export function notificationBody(reminder: Pick<Reminder, 'details' | 'category' | 'categoryData'>): string {
  const parts: string[] = []
  if (reminder.category === 'MEDICATION') {
    const data = (reminder.categoryData ?? {}) as MedicationData & { medications?: MedicationData[] }
    // Prefer the medications array; fall back to a legacy single-medication row.
    const meds = data.medications?.length ? data.medications : [data]
    for (const med of meds) {
      const text = formatMedication(med)
      if (text) parts.push(text)
    }
  }
  if (reminder.details) parts.push(reminder.details)
  return parts.join(' · ')
}
