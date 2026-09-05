/**
 * WebAuthn (passkey) relying-party config + challenge handling. The expected
 * challenge for an in-flight registration/authentication is stored in a short
 * httpOnly cookie (prefixed with the flow kind) and verified on finish.
 */
import type { Request, Response } from 'express'
import { clientOrigins, env } from './env.js'
import { badRequest } from './http-error.js'
import { readCookie, writeCookie } from './auth-session.js'

export const RP_NAME = 'Persistent'
const CHALLENGE_COOKIE = 'persistent_pk_challenge'
const CHALLENGE_MAX_AGE_SECONDS = 60 * 10

// The native app reports its origin as android:apk-key-hash:<base64url(sha256(cert))>
// rather than the https URL, so each signing certificate the app may ship under
// needs its own accepted origin.
//
// There are two. The app is enrolled in Play App Signing, so Play re-signs the
// `play` flavor with Google's key: a Play install reports a different origin than
// the sideloaded `direct` build signed with the release keystore, and both must be
// accepted or passkeys break on whichever was left out. Set ANDROID_APP_ORIGIN to a
// comma-separated list covering both; the default below is the release key alone,
// which is right for dev and wrong for production.
//
// Keep this in lockstep with apps/web/public/.well-known/assetlinks.json, the same
// certificates expressed as hex. `npm run android:origin -- <SHA-256>` converts one
// to the other.
//
// **The cert is only half of it.** That file is keyed by *package name* as well,
// and the two flavors install under different ones (`ca.persistent.app` sideloaded,
// `ca.dynamicsolutions.persistent` on Play). Credential Manager checks package and
// cert together on-device, so a Play build missing its package entry fails the
// ceremony before a request ever reaches this file, and nothing here can rescue it.
// That is exactly what shipped: the entry was added only when production was opened
// on 2026-09-05, so every internal/alpha build before that had passkeys dead while
// the sideloaded build a developer tests on worked perfectly.
const DEFAULT_ANDROID_APP_ORIGIN = 'android:apk-key-hash:TeqrYvSE9JO8zCVuXNwiUkDQKT7CsnFR1ss1TWHGpf0'

const androidAppOrigins = (env.ANDROID_APP_ORIGIN ?? DEFAULT_ANDROID_APP_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

type ChallengeKind = 'registration' | 'authentication'

/** Relying-party id (hostname) + the allowed origins (web + the native app). */
export function relyingParty(): { id: string; origins: string[] } {
  const origins = clientOrigins.map((o) => o.trim()).filter(Boolean)
  const first = origins[0]
  if (!first) throw new Error('CLIENT_ORIGIN must include at least one origin for passkeys.')
  return { id: new URL(first).hostname, origins: [...origins, ...androidAppOrigins] }
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
