/**
 * Auth contracts: passwordless email one-time-code sign-in/sign-up.
 *
 * Requesting a code for any email both registers (first time) and signs in
 * (returning), so email verification is inherent and there are no passwords to
 * reset. See docs/auth-architecture.md.
 */
import { z } from 'zod'

export const emailSchema = z.string().trim().toLowerCase().email().max(254)

/** Body for POST /api/auth/request-code. */
export const requestCodeSchema = z.object({
  email: emailSchema
})
export type RequestCodeInput = z.infer<typeof requestCodeSchema>

/** Response for POST /api/auth/request-code. `previewCode` is non-null only in demo mode. */
export const requestCodeResponseSchema = z.object({
  ok: z.literal(true),
  expiresAt: z.string().datetime(),
  previewCode: z.string().nullable()
})
export type RequestCodeResponse = z.infer<typeof requestCodeResponseSchema>

/** Body for POST /api/auth/verify-code. */
export const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z.string().trim().min(4).max(12),
  // Captured at verify time so schedules render in the user's local zone.
  timeZone: z.string().max(64).optional(),
  displayName: z.string().trim().max(120).optional()
})
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>

/** The authenticated user as surfaced to the client (never includes secrets). */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  timeZone: z.string(),
  createdAt: z.string().datetime()
})
export type SessionUser = z.infer<typeof sessionUserSchema>

/** Response for /api/auth/me and successful verify-code. */
export const authStateSchema = z.object({
  user: sessionUserSchema.nullable()
})
export type AuthState = z.infer<typeof authStateSchema>

// --- Passkeys (WebAuthn) ---

/** A registered passkey as surfaced to the client (no key material). */
export const passkeyInfoSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  aaguid: z.string().nullable(),
  transports: z.array(z.string()),
  backedUp: z.boolean(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable()
})
export type PasskeyInfo = z.infer<typeof passkeyInfoSchema>

export const passkeyListResponseSchema = z.object({ passkeys: z.array(passkeyInfoSchema) })
export type PasskeyListResponse = z.infer<typeof passkeyListResponseSchema>

/** Optional nickname when finishing a passkey registration. */
export const passkeyRegisterFinishSchema = z.object({
  response: z.unknown(),
  name: z.string().trim().max(60).optional()
})
