/**
 * Browser Web Push subscription flow: request permission, subscribe via the
 * server's VAPID public key, and register the endpoint with the API. The SW
 * (public/push-handler.js) shows the notifications.
 */
import { apiFetch } from './apiClient.js'
import type { PushConfig } from '@persistent/shared'

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function notificationPermission(): NotificationPermission {
  return typeof Notification !== 'undefined' ? Notification.permission : 'denied'
}

export async function getPushConfig(): Promise<PushConfig> {
  return apiFetch<PushConfig>('/api/push/config')
}

/** Request permission (if needed), subscribe, and register with the server. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const registration = await navigator.serviceWorker.ready
  const config = await getPushConfig()

  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(config.vapidPublicKey)
    }))

  const json = subscription.toJSON()
  await apiFetch('/api/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'WEB',
      subscription: { endpoint: json.endpoint, keys: json.keys }
    })
  })
  return true
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await apiFetch('/api/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpointOrToken: subscription.endpoint })
  }).catch(() => {})
  await subscription.unsubscribe()
}

function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i)
  return buffer
}
