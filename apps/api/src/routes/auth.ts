/**
 * Auth routes: passwordless email-code sign-up/sign-in, plus session lifecycle.
 *
 * - POST /api/auth/request-code  — issue a one-time code (rate-limited).
 * - POST /api/auth/verify-code   — verify, upsert the user, start a session.
 * - POST /api/auth/logout        — revoke the current session.
 * - GET  /api/auth/me            — current user or null.
 * - DELETE /api/auth/me          — permanently delete the account and all its data.
 */
import { Router } from 'express'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture, RegistrationResponseJSON } from '@simplewebauthn/server'
import { OAuth2Client } from 'google-auth-library'
import {
  deleteAccountSchema,
  googleLoginSchema,
  passkeyListResponseSchema,
  passkeyRegisterFinishSchema,
  requestCodeSchema,
  verifyCodeSchema
} from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { env } from '../lib/env.js'
import { badRequest, notFound, tooManyRequests, unauthorized } from '../lib/http-error.js'
import { issueEmailCode, verifyEmailCode } from '../lib/email-code.js'
import { createSession, revokeSession, setSessionCookie, clearSessionCookie } from '../lib/auth-session.js'
import { requireUserId } from '../lib/auth-middleware.js'
import { RP_NAME, relyingParty, setChallengeCookie, clearChallengeCookie, requireChallenge } from '../lib/webauthn.js'
import { rateLimit } from '../lib/rate-limit.js'
import { isReviewAccount, isReviewLogin } from '../lib/review-access.js'
import { logger } from '../lib/logger.js'
import { toPasskey, toSessionUser } from '../lib/serializers.js'

export const authRouter = Router()

authRouter.post('/request-code', async (request, response) => {
  const ip = request.ip ?? 'unknown'
  if (!rateLimit(`request-code:${ip}`, 12, 15 * 60_000)) {
    throw tooManyRequests('Too many requests. Try again later.')
  }
  const parsed = requestCodeSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Enter a valid email address.')

  // The review account's code is fixed, so there is nothing to issue or send —
  // just advance the client to the code screen. Reporting the same shape as a real
  // request keeps the account indistinguishable from any other from the outside.
  if (isReviewAccount(parsed.data.email)) {
    response.json({
      ok: true as const,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      previewCode: null
    })
    return
  }

  const result = await issueEmailCode(parsed.data.email)
  response.json({
    ok: true as const,
    expiresAt: result.expiresAt.toISOString(),
    previewCode: result.previewCode
  })
})

authRouter.post('/verify-code', async (request, response) => {
  // Codes are short and the review account's never expires, so this endpoint is
  // the one worth throttling against guessing. Generous enough that a user
  // mistyping a real code several times is unaffected.
  const verifyIp = request.ip ?? 'unknown'
  if (!rateLimit(`verify-code:${verifyIp}`, 20, 15 * 60_000)) {
    throw tooManyRequests('Too many attempts. Try again later.')
  }
  const parsed = verifyCodeSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Enter the code from your email.')
  const { email, code, timeZone, displayName } = parsed.data

  // The review account bypasses the emailed-code table entirely (see
  // lib/review-access.ts); every other address goes through it as normal.
  const ok = isReviewLogin(email, code) || (await verifyEmailCode(email, code))
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

// Public config so the client knows which auth methods to offer.
authRouter.get('/config', (_request, response) => {
  response.json({ googleClientId: env.GOOGLE_WEB_CLIENT_ID || null })
})

const googleClient = new OAuth2Client()

// Sign in with Google: verify the ID token, upsert the user by email, start a session.
authRouter.post('/google', async (request, response) => {
  if (!env.GOOGLE_WEB_CLIENT_ID) throw badRequest('Google sign-in is not configured.')
  const parsed = googleLoginSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid Google credential.')

  let payload
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: parsed.data.credential,
      audience: env.GOOGLE_WEB_CLIENT_ID
    })
    payload = ticket.getPayload()
  } catch {
    throw unauthorized('Could not verify the Google sign-in.')
  }
  if (!payload?.email || !payload.email_verified) throw unauthorized('Google account email is not verified.')

  const user = await prisma.user.upsert({
    where: { email: payload.email },
    update: {
      ...(parsed.data.timeZone ? { timeZone: parsed.data.timeZone } : {}),
      ...(payload.name ? { displayName: payload.name } : {})
    },
    create: {
      email: payload.email,
      timeZone: parsed.data.timeZone ?? 'UTC',
      displayName: payload.name ?? null
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

/**
 * Permanently delete the signed-in account and everything it owns.
 *
 * Every child row (Session, Passkey, Reminder, ReminderOccurrence,
 * PushSubscription) is removed by the schema's `onDelete: Cascade`, so deleting
 * the User row is sufficient and atomic. Irreversible — there is no soft-delete
 * or restore window, which is why the caller must echo their own email back.
 */
authRouter.delete('/me', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = deleteAccountSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Confirm your email address to delete your account.')

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw notFound('Account not found.')
  // Guards against a mistyped confirmation deleting the wrong (i.e. this) account.
  if (parsed.data.confirmEmail !== user.email.toLowerCase()) {
    throw badRequest("That email doesn't match this account.")
  }

  // EmailCode is keyed by email address, not userId, so it has no cascade —
  // clear it explicitly or the address outlives the account it identified.
  await prisma.$transaction([
    prisma.emailCode.deleteMany({ where: { email: user.email } }),
    prisma.user.delete({ where: { id: userId } })
  ])
  clearSessionCookie(response)
  // Irreversible and user-initiated: worth an operational record, but it is a
  // successful action rather than a failure, so info rather than warn.
  logger.info('account deleted', { userId })
  response.json({ ok: true })
})

// --- Passkeys (WebAuthn) ----------------------------------------------------

function csvToTransports(csv: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!csv) return undefined
  const list = csv.split(',').map((s) => s.trim()).filter(Boolean)
  return list.length ? (list as AuthenticatorTransportFuture[]) : undefined
}

function transportsToCsv(transports?: AuthenticatorTransportFuture[]): string | null {
  return transports && transports.length ? transports.join(',') : null
}

// Begin registering a passkey for the signed-in user.
authRouter.post('/passkey/register/options', async (request, response) => {
  const userId = requireUserId(request)
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { passkeys: { select: { credentialId: true, transports: true } } }
  })
  const rp = relyingParty()
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.displayName ?? user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    excludeCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: csvToTransports(p.transports) }))
  })
  setChallengeCookie(response, 'registration', options.challenge)
  response.json({ options })
})

// Finish registration: verify the attestation and store the credential.
authRouter.post('/passkey/register/verify', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = passkeyRegisterFinishSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid passkey registration.')

  const rp = relyingParty()
  const verification = await verifyRegistrationResponse({
    response: parsed.data.response as RegistrationResponseJSON,
    expectedChallenge: requireChallenge(request, 'registration'),
    expectedOrigin: rp.origins,
    expectedRPID: rp.id,
    requireUserVerification: false
  })
  if (!verification.verified || !verification.registrationInfo) throw badRequest('Passkey could not be verified.')

  const { credential, credentialBackedUp } = verification.registrationInfo
  await prisma.passkey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: transportsToCsv(credential.transports),
      aaguid: verification.registrationInfo.aaguid,
      backedUp: credentialBackedUp,
      name: parsed.data.name ?? null
    }
  })
  clearChallengeCookie(response)
  response.status(201).json({ ok: true })
})

// Begin a passwordless sign-in with a discoverable passkey.
authRouter.post('/passkey/authenticate/options', async (_request, response) => {
  const rp = relyingParty()
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: 'preferred' })
  setChallengeCookie(response, 'authentication', options.challenge)
  response.json({ options })
})

// Finish sign-in: verify the assertion against the stored credential, start a session.
authRouter.post('/passkey/authenticate/verify', async (request, response) => {
  const assertion = (request.body as { response?: unknown })?.response as AuthenticationResponseJSON | undefined
  if (!assertion?.id) throw badRequest('Invalid passkey authentication.')

  const stored = await prisma.passkey.findUnique({ where: { credentialId: assertion.id }, include: { user: true } })
  if (!stored) throw unauthorized('Passkey not recognized.')

  const rp = relyingParty()
  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: requireChallenge(request, 'authentication'),
    expectedOrigin: rp.origins,
    expectedRPID: rp.id,
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(stored.publicKey),
      counter: stored.counter,
      transports: csvToTransports(stored.transports)
    },
    requireUserVerification: false
  })
  if (!verification.verified) throw unauthorized('Passkey verification failed.')

  await prisma.passkey.update({
    where: { id: stored.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() }
  })

  const session = await createSession(stored.userId, request)
  setSessionCookie(response, session.secret, session.expiresAt)
  clearChallengeCookie(response)
  response.json({ user: toSessionUser(stored.user) })
})

// List / remove the signed-in user's passkeys.
authRouter.get('/passkeys', async (request, response) => {
  const userId = requireUserId(request)
  const passkeys = await prisma.passkey.findMany({
    where: { userId },
    orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }]
  })
  response.json(passkeyListResponseSchema.parse({ passkeys: passkeys.map(toPasskey) }))
})

authRouter.delete('/passkeys/:id', async (request, response) => {
  const userId = requireUserId(request)
  const existing = await prisma.passkey.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Passkey not found.')
  await prisma.passkey.delete({ where: { id: existing.id } })
  response.json({ ok: true })
})
