/**
 * Centralizes turning a reminder/occurrence into notification copy, so every
 * channel (web push, FCM, escalation email) shows consistent text. Shares the
 * body formatter with the web client via @persistent/shared.
 */
import type { Reminder } from '@prisma/client'
import { reminderBodyText, type TypeData, type ReminderType } from '@persistent/shared'

export function notificationTitle(reminder: Pick<Reminder, 'title'>): string {
  return reminder.title
}

export function notificationBody(reminder: Pick<Reminder, 'details' | 'type' | 'typeData'>): string {
  return reminderBodyText({
    type: reminder.type as ReminderType,
    typeData: (reminder.typeData ?? {}) as TypeData,
    details: reminder.details
  })
}

/**
 * Text body of the escalation email: the user's covering message (or a default),
 * then the reminder's own body so the recipient sees *what* is overdue and not
 * just its title. Plain-text email, so the line breaks the user typed into
 * details survive as written.
 */
export function escalationEmailText(
  reminder: Pick<Reminder, 'title' | 'details' | 'type' | 'typeData' | 'escalateEmailMessage'>
): string {
  const message =
    reminder.escalateEmailMessage?.trim() || `The reminder "${reminder.title}" is overdue and hasn't been confirmed.`
  const body = notificationBody(reminder)
  return body ? `${message}\n\n${body}` : message
}
