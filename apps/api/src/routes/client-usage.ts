/** Record bounded client metadata on the caller's own session, without a device fingerprint. */
import { Router } from 'express'
import { clientUsageSchema } from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { requireUserId } from '../lib/auth-middleware.js'
import { AUTH_COOKIE_NAME, hashSecret, readCookie } from '../lib/auth-session.js'
import { badRequest, unauthorized } from '../lib/http-error.js'

export const clientUsageRouter = Router()

clientUsageRouter.post('/', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = clientUsageSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid client identity.')
  const secret = readCookie(request.headers.cookie ?? '', AUTH_COOKIE_NAME)
  if (!secret) throw unauthorized('Sign in to continue.')
  const now = new Date()
  const result = await prisma.session.updateMany({
    where: { userId, secretHash: hashSecret(secret), revokedAt: null, expiresAt: { gt: now } },
    data: {
      clientApp: parsed.data.app,
      clientPlatform: parsed.data.platform,
      webVersion: parsed.data.webVersion,
      nativeVersion: parsed.data.nativeVersion,
      clientReportedAt: now
    }
  })
  if (result.count !== 1) throw unauthorized('Sign in to continue.')
  response.setHeader('Cache-Control', 'no-store')
  response.json({ ok: true })
})
