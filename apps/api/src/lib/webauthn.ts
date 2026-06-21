/**
 * WebAuthn (passkey) relying-party config + challenge handling. The expected
 * challenge for an in-flight registration/authentication is stored in a short
 * httpOnly cookie (prefixed with the flow kind) and verified on finish.
 */
import type { Request, Response } from 'express'
import { clientOrigins } from './env.js'
import { badRequest } from './http-error.js'
import { readCookie, writeCookie } from './auth-session.js'

export const RP_NAME = 'Persistent'
const CHALLENGE_COOKIE = 'persistent_pk_challenge'
const CHALLENGE_MAX_AGE_SECONDS = 60 * 10

type ChallengeKind = 'registration' | 'authentication'

/** Relying-party id (hostname) + the allowed origins, from CLIENT_ORIGIN. */
export function relyingParty(): { id: string; origins: string[] } {
  const origins = clientOrigins.map((o) => o.trim()).filter(Boolean)
  const first = origins[0]
  if (!first) throw new Error('CLIENT_ORIGIN must include at least one origin for passkeys.')
  return { id: new URL(first).hostname, origins }
}

export function setChallengeCookie(response: Response, kind: ChallengeKind, challenge: string): void {
  writeCookie(response, CHALLENGE_COOKIE, `${kind}:${challenge}`, CHALLENGE_MAX_AGE_SECONDS)
}

export function clearChallengeCookie(response: Response): void {
  writeCookie(response, CHALLENGE_COOKIE, '', 0)
}

/** Read + validate the stored challenge for the given flow, or 400. */
export function requireChallenge(request: Request, kind: ChallengeKind): string {
  const raw = readCookie(request.headers.cookie ?? '', CHALLENGE_COOKIE)
  if (!raw) throw badRequest('Passkey challenge expired. Please try again.')
  const sep = raw.indexOf(':')
  const storedKind = sep >= 0 ? raw.slice(0, sep) : ''
  const value = sep >= 0 ? raw.slice(sep + 1) : ''
  if (storedKind !== kind || !value) throw badRequest('Passkey challenge mismatch. Please try again.')
  return value
}
