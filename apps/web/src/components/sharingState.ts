/** The card marker reflects active access before pending invitations. */
import type { Reminder } from '@persistent/shared'

export type SharingState = 'shared' | 'invited' | undefined

export function sharingState(reminder: Pick<Reminder, 'shareCount' | 'invitationCount'>): SharingState {
  if (reminder.shareCount > 0) return 'shared'
  if (reminder.invitationCount > 0) return 'invited'
  return undefined
}
