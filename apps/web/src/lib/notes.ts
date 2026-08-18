/**
 * What makes a reminder a note, in one place.
 *
 * A note is schedule kind `never` — it produces no occurrence, so nothing about it can
 * nag, escalate or need confirming (`docs/notification-behavior.md` §7). Four surfaces
 * ask the question now (the Notes tab and its page, the tab bar deciding whether to
 * offer itself, Upcoming excluding them, and the editor's landing tab), which is three
 * more than justifies leaving the comparison inline.
 */
import type { Reminder } from '@persistent/shared'

export function isNote(reminder: Reminder): boolean {
  return reminder.schedule.kind === 'never'
}
