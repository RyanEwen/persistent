/** Project received grants into the same reminder definitions used by list views. */
import type { Reminder, SharedReminder } from '@persistent/shared'

/** Access stays tied to the live received-share query, never the owned cache. */
export function receivedReminders(shares: readonly SharedReminder[]): Reminder[] {
  return shares.flatMap((share) => share.editableReminder ? [share.editableReminder] : [])
}

/** Mark received cards without changing their reminder definition. */
export function receivedReminderIds(shares: readonly SharedReminder[]): Set<string> {
  return new Set(shares.map((share) => share.id))
}
