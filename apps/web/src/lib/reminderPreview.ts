import { reminderBodyText, type Reminder } from '@persistent/shared'

/** Fields shared by current reminders and the compact snapshot held in History. */
export type ReminderPreviewSource = Pick<Reminder, 'title' | 'type' | 'details' | 'typeData'> & {
  hideCheckedItems?: boolean
}

/** Keep a checklist's item text out of the prose shown beside its visual rows. */
export function reminderPreviewBody(reminder: ReminderPreviewSource): string {
  return reminder.type === 'TODO' ? reminder.details ?? '' : reminderBodyText(reminder)
}
