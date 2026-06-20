/**
 * Push subscription + device contracts.
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
    subscription: webPushSubscriptionSchema,
    deviceLabel: z.string().trim().max(120).optional()
  }),
  z.object({
    kind: z.literal('FCM'),
    token: z.string().min(1).max(4096),
    deviceLabel: z.string().trim().max(120).optional()
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
  type: z.enum(['fire', 'escalate', 'dismiss', 'sync']),
  occurrenceId: z.string().optional(),
  reminderId: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  alarm: z.boolean().optional(),
  soundIntervalSeconds: z.number().int().nullable().optional(),
  scheduledFor: z.string().datetime().optional()
})
export type PushPayload = z.infer<typeof pushPayloadSchema>
