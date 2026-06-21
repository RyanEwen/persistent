/**
 * Centralizes turning a reminder/occurrence into notification copy, so every
 * channel (web push, FCM, escalation email) shows consistent text. Shares the
 * body formatter with the web client via @persistent/shared.
 */
import type { Reminder } from '@prisma/client'
import { reminderBodyText, type CategoryData, type ReminderCategory } from '@persistent/shared'

export function notificationTitle(reminder: Pick<Reminder, 'title'>): string {
  return reminder.title
}

export function notificationBody(reminder: Pick<Reminder, 'details' | 'category' | 'categoryData'>): string {
  return reminderBodyText({
    category: reminder.category as ReminderCategory,
    categoryData: (reminder.categoryData ?? {}) as CategoryData,
    details: reminder.details
  })
}
