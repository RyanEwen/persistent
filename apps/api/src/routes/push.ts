/**
 * Push subscription management. The web client registers a Web Push (VAPID)
 * endpoint; the native Android client registers an FCM token. Both upsert by
 * their unique endpoint/token so re-subscribing never duplicates rows.
 */
import { Router } from 'express'
import { registerSubscriptionSchema, unregisterSubscriptionSchema } from '@persistent/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest } from '../lib/http-error.js'
import { getVapidPublicKey, isFcmConfigured } from '../lib/delivery/index.js'

export const pushRouter = Router()
pushRouter.use(requireUser)

pushRouter.get('/config', async (request, response) => {
  const userId = requireUserId(request)
  const [vapidPublicKey, subscriptions] = await Promise.all([
    getVapidPublicKey(),
    prisma.pushSubscription.count({ where: { userId } })
  ])
  response.json({ vapidPublicKey, fcmEnabled: isFcmConfigured(), subscriptions })
})

pushRouter.post('/subscriptions', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = registerSubscriptionSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid subscription payload.')

  const endpoint = parsed.data.kind === 'WEB' ? parsed.data.subscription.endpoint : parsed.data.token
  const keys: Prisma.InputJsonValue | undefined =
    parsed.data.kind === 'WEB' ? parsed.data.subscription.keys : undefined

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId, kind: parsed.data.kind, ...(keys ? { keys } : {}), userAgent: readUserAgent(request) },
    create: {
      userId,
      kind: parsed.data.kind,
      endpoint,
      ...(keys ? { keys } : {}),
      userAgent: readUserAgent(request)
    }
  })

  const subscriptions = await prisma.pushSubscription.count({ where: { userId } })
  response.status(201).json({ subscriptions })
})

pushRouter.delete('/subscriptions', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = unregisterSubscriptionSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid unsubscribe payload.')

  const result = await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint: parsed.data.endpointOrToken }
  })
  response.json({ removed: result.count > 0 })
})

function readUserAgent(request: { headers: Record<string, unknown> }): string | undefined {
  const value = request.headers['user-agent']
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 256) : undefined
}
