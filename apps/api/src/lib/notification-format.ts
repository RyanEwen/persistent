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

/**
 * @param checkedItemIds the ticks of the firing this notification is for
 *   (`ReminderOccurrence.checkedItems`). Ticked checklist items are left out, so
 *   a nag lists only what is still outstanding — every caller here is describing
 *   one firing, so every caller should pass them.
 */
export function notificationBody(
  reminder: Pick<Reminder, 'details' | 'type' | 'typeData'>,
  checkedItemIds: readonly string[] = []
): string {
  return reminderBodyText(
    {
      type: reminder.type as ReminderType,
      typeData: (reminder.typeData ?? {}) as TypeData,
      details: reminder.details
    },
    checkedItemIds
  )
}

/**
 * Text body of the escalation email: the user's covering message (or a default),
 * then the reminder's own body so the recipient sees *what* is overdue and not
 * just its title. Plain-text email, so the line breaks the user typed into
 * details survive as written. A checklist lists what is still unticked at the
 * moment of sending — the email is a snapshot, so it reports what the contact
 * would be chasing rather than work already done.
 */
export function escalationEmailText(
  reminder: Pick<Reminder, 'title' | 'details' | 'type' | 'typeData' | 'escalateEmailMessage'>,
  checkedItemIds: readonly string[] = []
): string {
  const message =
    reminder.escalateEmailMessage?.trim() || `The reminder "${reminder.title}" is overdue and hasn't been confirmed.`
  const body = notificationBody(reminder, checkedItemIds)
  return body ? `${message}\n\n${body}` : message
}
