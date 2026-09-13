/**
 * Native push dispatcher. FCM is the server backup for Android's on-device
 * alarms; the escalation email channel targets a contact separately.
 */
import type { PushPayload } from '@persistent/shared'
import { sendFcmPush, isFcmConfigured } from './fcm-push.js'

export { isFcmConfigured }

/** Deliver a push payload to all of a user's registered Android devices. */
export async function dispatchToUser(userId: string, payload: PushPayload): Promise<void> {
  await sendFcmPush(userId, payload)
}

/**
 * Nudge the user's native devices to resync their on-device alarms.
 * Used on reminder edits, which have no self-contained fire/dismiss payload but
 * still change what a device should schedule/show. Native devices with a live
 * bridge resync on this; the on-device alarm
 * plus the fire/dismiss pushes remain the backstop while the app is fully closed.
 */
export async function nudgeNativeSync(userId: string): Promise<void> {
  await sendFcmPush(userId, { type: 'sync' })
}
