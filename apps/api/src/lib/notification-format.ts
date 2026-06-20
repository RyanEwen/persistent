/**
 * Centralizes turning a reminder/occurrence into notification copy, so every
 * channel (web push, FCM, escalation email) shows consistent text.
 */
import type { Reminder } from '@prisma/client'
import type { MedicationData } from '@persistent/shared'

export function notificationTitle(reminder: Pick<Reminder, 'title'>): string {
  return reminder.title
}

export function notificationBody(reminder: Pick<Reminder, 'details' | 'category' | 'categoryData'>): string {
  const parts: string[] = []
  if (reminder.category === 'MEDICATION') {
    const med = (reminder.categoryData ?? {}) as MedicationData
    const dose = [med.quantity, med.unit].filter(Boolean).join(' ')
    if (med.dose) parts.push(med.dose)
    if (dose) parts.push(dose)
  }
  if (reminder.details) parts.push(reminder.details)
  return parts.join(' · ')
}
