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

/** Send a data message to all of a user's FCM device tokens; prune dead ones. */
export async function sendFcmPush(userId: string, payload: PushPayload): Promise<void> {
  if (!isFcmConfigured()) return
  const subs = await prisma.pushSubscription.findMany({ where: { userId, kind: 'FCM' } })
  if (subs.length === 0) return

  let accessToken: string | null | undefined
  try {
    const client = await getAuthClient()
    accessToken = await client.getAccessToken()
  } catch (error) {
    logger.warn('fcm auth failed', { error: String(error) })
    return
  }
  if (!accessToken) return

  const url = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`
  // FCM data values must be strings; the native client parses them back.
  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) data[key] = String(value)
  }

  const dead: string[] = []
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message: { token: sub.endpoint, data, android: { priority: 'high' } } })
        })
        if (response.status === 404 || response.status === 403) {
          dead.push(sub.endpoint)
        } else if (!response.ok) {
          logger.warn('fcm delivery failed', { status: response.status })
        }
      } catch (error) {
        logger.warn('fcm delivery error', { error: String(error) })
      }
    })
  )

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } })
    logger.info(`pruned ${dead.length} dead FCM token(s)`)
  }
}
