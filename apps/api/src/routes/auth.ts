/**
 * Auth routes: passwordless email-code sign-up/sign-in, plus session lifecycle.
 *
 * - POST /api/auth/request-code  — issue a one-time code (rate-limited).
 * - POST /api/auth/verify-code   — verify, upsert the user, start a session.
 * - POST /api/auth/logout        — revoke the current session.
 * - GET  /api/auth/me            — current user or null.
 */
import { Router } from 'express'
import { requestCodeSchema, verifyCodeSchema } from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { badRequest, tooManyRequests } from '../lib/http-error.js'
import { issueEmailCode, verifyEmailCode } from '../lib/email-code.js'
import { createSession, revokeSession, setSessionCookie, clearSessionCookie } from '../lib/auth-session.js'
import { rateLimit } from '../lib/rate-limit.js'
import { toSessionUser } from '../lib/serializers.js'

export const authRouter = Router()

authRouter.post('/request-code', async (request, response) => {
  const ip = request.ip ?? 'unknown'
  if (!rateLimit(`request-code:${ip}`, 12, 15 * 60_000)) {
    throw tooManyRequests('Too many requests. Try again later.')
  }
  const parsed = requestCodeSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Enter a valid email address.')

  const result = await issueEmailCode(parsed.data.email)
  response.json({
    ok: true as const,
    expiresAt: result.expiresAt.toISOString(),
    previewCode: result.previewCode
  })
})

authRouter.post('/verify-code', async (request, response) => {
  const parsed = verifyCodeSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Enter the code from your email.')
  const { email, code, timeZone, displayName } = parsed.data

  const ok = await verifyEmailCode(email, code)
  if (!ok) throw badRequest('That code is invalid or expired.')

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      ...(timeZone ? { timeZone } : {}),
      ...(displayName ? { displayName } : {})
    },
    create: {
      email,
      timeZone: timeZone ?? 'UTC',
      displayName: displayName ?? null
    }
  })

  const session = await createSession(user.id, request)
  setSessionCookie(response, session.secret, session.expiresAt)
  response.json({ user: toSessionUser(user) })
})

authRouter.post('/logout', async (request, response) => {
  await revokeSession(request)
  clearSessionCookie(response)
  response.json({ ok: true })
})

authRouter.get('/me', async (request, response) => {
  if (!request.userId) {
    response.json({ user: null })
    return
  }
  const user = await prisma.user.findUnique({ where: { id: request.userId } })
  response.json({ user: user ? toSessionUser(user) : null })
})
