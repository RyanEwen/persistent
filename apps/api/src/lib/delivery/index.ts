/**
 * Push dispatcher: fans a payload to every channel for a user (Web Push + FCM).
 * The escalation email channel lives separately in lib/cloudflare-email.ts since
 * it targets a contact, not the user's own devices.
 */
import type { PushPayload } from '@persistent/shared'
import { sendWebPush, getVapidPublicKey } from './web-push.js'
import { sendFcmPush, isFcmConfigured } from './fcm-push.js'

export { getVapidPublicKey, isFcmConfigured }

/** Deliver a push payload to all of a user's registered devices, all channels. */
export async function dispatchToUser(userId: string, payload: PushPayload): Promise<void> {
  await Promise.all([sendWebPush(userId, payload), sendFcmPush(userId, payload)])
}

/**
 * Nudge the user's native devices to resync their on-device alarms — FCM only.
 * Used on reminder edits, which have no self-contained fire/dismiss payload but
 * still change what a device should schedule/show. We deliberately skip Web Push:
 * a push event that shows no notification makes browsers surface a generic "site
 * updated" notification, and open web clients already converge over the WS
 * broadcast. Native devices with a live bridge resync on this; the on-device alarm
 * plus the fire/dismiss pushes remain the backstop while the app is fully closed.
 */
export async function nudgeNativeSync(userId: string): Promise<void> {
  await sendFcmPush(userId, { type: 'sync' })
}
