/**
 * Web Push (VAPID) delivery against the per-user PushSubscription table.
 *
 * VAPID keys come from env when set, otherwise a keypair is generated once and
 * persisted in the Setting store so existing browser subscriptions stay valid
 * across restarts. Adapted from printstream's WebPushDelivery.
 */
import webpush from 'web-push'
import type { PushPayload } from '@persistent/shared'
import { prisma } from '../prisma.js'
import { env } from '../env.js'
import { logger } from '../logger.js'

const VAPID_PUBLIC_SETTING = 'vapidPublicKey'
const VAPID_PRIVATE_SETTING = 'vapidPrivateKey'
const DEFAULT_SUBJECT = 'mailto:persistent@local'

let cached: { publicKey: string; privateKey: string; subject: string } | null = null

async function getVapid(): Promise<{ publicKey: string; privateKey: string; subject: string }> {
  if (cached) return cached
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT

  if (env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim()) {
    cached = { publicKey: env.VAPID_PUBLIC_KEY.trim(), privateKey: env.VAPID_PRIVATE_KEY.trim(), subject }
    return cached
  }

  const [pub, priv] = await Promise.all([
    prisma.setting.findUnique({ where: { key: VAPID_PUBLIC_SETTING } }),
    prisma.setting.findUnique({ where: { key: VAPID_PRIVATE_SETTING } })
  ])

  if (pub?.value && priv?.value) {
    cached = { publicKey: pub.value, privateKey: priv.value, subject }
    return cached
  }

  const keys = webpush.generateVAPIDKeys()
  await prisma.setting.upsert({
    where: { key: VAPID_PUBLIC_SETTING },
    update: { value: keys.publicKey },
    create: { key: VAPID_PUBLIC_SETTING, value: keys.publicKey }
  })
  await prisma.setting.upsert({
    where: { key: VAPID_PRIVATE_SETTING },
    update: { value: keys.privateKey },
    create: { key: VAPID_PRIVATE_SETTING, value: keys.privateKey }
  })
  logger.info('generated new VAPID keypair')
  cached = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject }
  return cached
}

export async function getVapidPublicKey(): Promise<string> {
  return (await getVapid()).publicKey
}

/** Send a payload to all of a user's WEB push subscriptions; prune dead ones. */
export async function sendWebPush(userId: string, payload: PushPayload): Promise<void> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId, kind: 'WEB' } })
  if (subs.length === 0) return

  const vapid = await getVapid()
  const body = JSON.stringify(payload)
  const dead: string[] = []

  await Promise.all(
    subs.map(async (sub) => {
      const keys = sub.keys as { p256dh: string; auth: string } | null
      if (!keys) return
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys },
          body,
          { vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 }
        )
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          dead.push(sub.endpoint)
        } else {
          logger.warn('web-push delivery failed', { endpoint: sub.endpoint, status })
        }
      }
    })
  )

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } })
    logger.info(`pruned ${dead.length} dead web-push subscription(s)`)
  }
}
