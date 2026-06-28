/**
 * Firebase Cloud Messaging (HTTP v1) delivery for native Android devices.
 *
 * Optional: when FCM_SERVICE_ACCOUNT_FILE / FCM_PROJECT_ID are unset this is a
 * no-op, so the app runs fine on web-only (on-device scheduling still covers
 * native reliability — FCM is the wake/ad-hoc/escalation backup). Auth uses a
 * service-account access token via google-auth-library.
 */
import { readFile } from 'node:fs/promises'
import type { PushPayload } from '@persistent/shared'
import { prisma } from '../prisma.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { classifyFcmStatus } from './fcm-status.js'

export function isFcmConfigured(): boolean {
  return Boolean(env.FCM_SERVICE_ACCOUNT_FILE?.trim() && env.FCM_PROJECT_ID?.trim())
}

let tokenSourcePromise: Promise<{ getAccessToken: () => Promise<string | null | undefined> }> | null = null

async function getAuthClient() {
  if (!tokenSourcePromise) {
    tokenSourcePromise = (async () => {
      const { GoogleAuth } = await import('google-auth-library')
      const credentials = JSON.parse(await readFile(env.FCM_SERVICE_ACCOUNT_FILE as string, 'utf8'))
      const auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/firebase.messaging']
      })
      return auth.getClient() as unknown as { getAccessToken: () => Promise<string | null | undefined> }
    })()
  }
  return tokenSourcePromise
}

/**
 * Drop the cached auth client so the next mint rebuilds it from scratch. The
 * long-lived client caches its access token by a computed expiry; if that token
 * is ever rejected (401) while the client still believes it valid, it would keep
 * handing back the same dead token forever — a fresh client re-mints cleanly.
 */
function resetAuthClient(): void {
  tokenSourcePromise = null
}

/** Mint a service-account access token, or null on failure (logged). */
async function mintAccessToken(): Promise<string | null> {
  try {
    const client = await getAuthClient()
    const token = await client.getAccessToken()
    return token ?? null
  } catch (error) {
    logger.warn('fcm auth failed', { error: String(error) })
    return null
  }
}

type SendResult = { endpoint: string; status: number; body?: string }

async function sendOne(
  url: string,
  accessToken: string,
  endpoint: string,
  data: Record<string, string>
): Promise<SendResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: endpoint, data, android: { priority: 'high' } } })
    })
    if (response.ok) return { endpoint, status: response.status }
    // Keep FCM's error body (truncated) so an auth/permission failure is
    // diagnosable from the logs instead of being a bare status number.
    const body = await response.text().catch(() => '')
    return { endpoint, status: response.status, body: body.slice(0, 300) }
  } catch (error) {
    logger.warn('fcm delivery error', { error: String(error) })
    return { endpoint, status: 0 }
  }
}

/**
 * Send a data message to all of a user's FCM device tokens; prune dead ones.
 *
 * A 401 means OUR cached service-account token was rejected (not the device
 * token), so we re-mint once with a fresh client and retry the affected sends —
 * otherwise a wedged token would silently drop every notification until the
 * process restarts. The device token is only pruned on 403/404.
 */
export async function sendFcmPush(userId: string, payload: PushPayload): Promise<void> {
  if (!isFcmConfigured()) return
  const subs = await prisma.pushSubscription.findMany({ where: { userId, kind: 'FCM' } })
  if (subs.length === 0) return

  let accessToken = await mintAccessToken()
  if (!accessToken) return

  const url = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`
  // FCM data values must be strings; the native client parses them back.
  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) data[key] = String(value)
  }

  const dead: string[] = []
  let pending = subs.map((sub) => sub.endpoint)
  let refreshedAuth = false

  // At most two passes: the second only runs after a 401 forces an auth refresh.
  for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
    const token = accessToken
    const results = await Promise.all(pending.map((endpoint) => sendOne(url, token, endpoint, data)))

    const retryAuth: string[] = []
    for (const result of results) {
      const disposition = classifyFcmStatus(result.status)
      if (disposition === 'ok') continue
      if (disposition === 'prune') {
        dead.push(result.endpoint)
      } else if (disposition === 'authRefresh' && !refreshedAuth) {
        retryAuth.push(result.endpoint)
      } else {
        logger.warn('fcm delivery failed', { status: result.status, body: result.body })
      }
    }

    if (retryAuth.length === 0) break

    // Our access token was rejected: rebuild the client, re-mint, and retry once.
    resetAuthClient()
    const fresh = await mintAccessToken()
    refreshedAuth = true
    if (!fresh) {
      logger.warn('fcm auth refresh failed after 401; dropping this delivery')
      break
    }
    accessToken = fresh
    pending = retryAuth
    logger.info(`refreshed FCM auth after 401; retrying ${retryAuth.length} send(s)`)
  }

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } })
    logger.info(`pruned ${dead.length} dead FCM token(s)`)
  }
}
