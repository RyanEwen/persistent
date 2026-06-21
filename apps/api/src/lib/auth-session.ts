/**
 * Cookie-backed auth sessions (single-user ownership; no tenancy).
 *
 * The raw secret lives only in the cookie; the database stores a SHA-256 hash.
 * Sessions idle-refresh so active users stay signed in. Adapted, much thinner,
 * from printstream's auth-session.
 */
import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import { prisma } from './prisma.js'
import { clientOrigins } from './env.js'

export const AUTH_COOKIE_NAME = 'persistent_auth'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('base64url')
}

export async function createSession(userId: string, request?: Request): Promise<{ secret: string; expiresAt: Date }> {
  const secret = crypto.randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)
  await prisma.session.create({
    data: {
      secretHash: hashSecret(secret),
      userId,
      expiresAt,
      lastSeenAt: now,
      userAgent: readUserAgent(request)
    }
  })
  return { secret, expiresAt }
}

/** Resolve the signed-in user id from the request cookie, or null. Idle-refreshes. */
export async function resolveUserId(request: Request, response?: Response): Promise<string | null> {
  const secret = readCookie(request.headers.cookie ?? '', AUTH_COOKIE_NAME)
  if (!secret) return null

  const session = await prisma.session.findUnique({
    where: { secretHash: hashSecret(secret) },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true, lastSeenAt: true }
  })

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null
  }

  await refreshActivity(session, secret, response)
  return session.userId
}

export async function revokeSession(request: Request): Promise<void> {
  const secret = readCookie(request.headers.cookie ?? '', AUTH_COOKIE_NAME)
  if (!secret) return
  await prisma.session.updateMany({
    where: { secretHash: hashSecret(secret), revokedAt: null },
    data: { revokedAt: new Date() }
  })
}

export function setSessionCookie(response: Response, secret: string, expiresAt: Date): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  writeCookie(response, AUTH_COOKIE_NAME, secret, maxAge)
}

export function clearSessionCookie(response: Response): void {
  writeCookie(response, AUTH_COOKIE_NAME, '', 0)
}

async function refreshActivity(
  session: { id: string; lastSeenAt: Date | null },
  secret: string,
  response?: Response
): Promise<void> {
  if (session.lastSeenAt && Date.now() - session.lastSeenAt.getTime() < LAST_SEEN_REFRESH_MS) {
    return
  }
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)
  await prisma.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { expiresAt, lastSeenAt: now }
  })
  if (response && !response.headersSent) {
    setSessionCookie(response, secret, expiresAt)
  }
}

function readUserAgent(request?: Request): string | null {
  const value = request?.headers['user-agent']
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 512) : null
}

export function readCookie(header: string, name: string): string | null {
  for (const segment of header.split(';')) {
    const [rawName, ...rest] = segment.trim().split('=')
    if (rawName !== name) continue
    const rawValue = rest.join('=')
    if (!rawValue) return null
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }
  return null
}

export function writeCookie(response: Response, name: string, value: string, maxAgeSeconds: number): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ]
  if (useSecureCookies(response)) parts.push('Secure')
  response.append('Set-Cookie', parts.join('; '))
}

function useSecureCookies(response: Response): boolean {
  const request = response.req as Pick<Request, 'secure' | 'headers'> | undefined
  if (request?.secure) return true
  const forwarded = request?.headers['x-forwarded-proto']
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  if (proto?.trim().toLowerCase() === 'https') return true
  return clientOrigins.some((origin) => {
    try {
      return new URL(origin).protocol === 'https:'
    } catch {
      return false
    }
  })
}
