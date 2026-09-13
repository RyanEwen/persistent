/**
 * FCM subscription management for native Android devices. Tokens upsert by
 * their unique value so re-registering never duplicates rows.
 */
import { Router } from 'express'
import { pushConfigSchema, registerSubscriptionSchema, unregisterSubscriptionSchema } from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest } from '../lib/http-error.js'
import { isFcmConfigured } from '../lib/delivery/index.js'

export const pushRouter = Router()
pushRouter.use(requireUser)

pushRouter.get('/config', async (request, response) => {
  requireUserId(request)
  response.json(pushConfigSchema.parse({ fcmEnabled: isFcmConfigured() }))
})

pushRouter.post('/subscriptions', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = registerSubscriptionSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid subscription payload.')

  const endpoint = parsed.data.token

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId, kind: 'FCM', userAgent: readUserAgent(request) },
    create: {
      userId,
      kind: 'FCM',
      endpoint,
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
