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
