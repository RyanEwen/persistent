/**
 * Push subscription contracts.
 *
 * Two push channels share one backend: WEB (browser Web Push / VAPID) and FCM
 * (native Android via Firebase Cloud Messaging). The web client also needs the
 * server's VAPID public key to subscribe.
 */
import { z } from 'zod'

export const pushKinds = ['WEB', 'FCM'] as const
export const pushKindSchema = z.enum(pushKinds)
export type PushKind = (typeof pushKinds)[number]

/** Browser PushSubscription shape (matches PushSubscriptionJSON). */
export const webPushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
})
export type WebPushSubscriptionInput = z.infer<typeof webPushSubscriptionSchema>

/** Body for POST /api/push/subscriptions. */
export const registerSubscriptionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('WEB'),
    subscription: webPushSubscriptionSchema
  }),
  z.object({
    kind: z.literal('FCM'),
    token: z.string().min(1).max(4096)
  })
])
export type RegisterSubscriptionInput = z.infer<typeof registerSubscriptionSchema>

/** Body for DELETE /api/push/subscriptions. */
export const unregisterSubscriptionSchema = z.object({
  endpointOrToken: z.string().min(1)
})
export type UnregisterSubscriptionInput = z.infer<typeof unregisterSubscriptionSchema>

/** Response for GET /api/push/config. */
export const pushConfigSchema = z.object({
  vapidPublicKey: z.string(),
  fcmEnabled: z.boolean(),
  subscriptions: z.number().int()
})
export type PushConfig = z.infer<typeof pushConfigSchema>

/**
 * The push payload delivered to a device when an occurrence fires (or
 * escalates). The native client uses `alarm`/`soundIntervalSeconds` to start
 * the foreground alarm service; the web service worker shows a notification.
 */
export const pushPayloadSchema = z.object({
  // 'silence' downgrades a ringing escalation back to a soft nag (stop the alarm,
  // keep the reminder firing) without acknowledging or snoozing it.
  type: z.enum(['fire', 'escalate', 'dismiss', 'sync', 'silence']),
  occurrenceId: z.string().optional(),
  reminderId: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  alarm: z.boolean().optional(),
  soundIntervalSeconds: z.number().int().nullable().optional(),
  scheduledFor: z.string().datetime().optional(),
  // The reminder's own tone for whichever kind this push is (`soundChoiceSchema`,
  // flattened to two scalars because FCM data values are strings — an object would
  // arrive as "[object Object]"). Omitted when the reminder overrides nothing, so
  // the device uses its own tone exactly as before.
  //
  // Unlike `shadeProminence`, which the push path hard-codes to INHERIT because
  // getting it wrong is only visual, this has to travel: a fire/escalate push only
  // acts when the device has NO local alarm for the occurrence, which is precisely
  // when it has no other way to learn the reminder's tone.
  soundUri: z.string().optional(),
  soundTitle: z.string().optional(),
  nagSoundUri: z.string().optional(),
  nagSoundTitle: z.string().optional()
})
export type PushPayload = z.infer<typeof pushPayloadSchema>
