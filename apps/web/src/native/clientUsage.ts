/** First-party session metadata for aggregate app/platform adoption, without persistent device identifiers. */
import type { ClientUsage } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { isNative, NativeApp } from './alarmBridge.js'
import { isDesktopHost } from './desktopBridge.js'

/** Prefer native bridge identity; browser/PWA distinction is the current display mode. */
export function classifyClient(native: boolean, desktop: boolean, standalone: boolean, userAgent: string): Pick<ClientUsage, 'app' | 'platform'> {
  if (native) return { app: 'android', platform: 'android' }
  if (desktop) return { app: 'windows', platform: 'windows' }

  let platform: ClientUsage['platform'] = 'unknown'
  if (/Android/i.test(userAgent)) platform = 'android'
  else if (/iPhone|iPad|iPod/i.test(userAgent)) platform = 'ios'
  else if (/Windows/i.test(userAgent)) platform = 'windows'
  else if (/Macintosh|Mac OS X/i.test(userAgent)) platform = 'macos'
  else if (/Linux/i.test(userAgent)) platform = 'linux'

  return { app: standalone ? 'pwa' : 'browser', platform }
}

/** Resolve optional native version metadata, then fence any account transition before reporting. */
export async function collectClientUsage(
  identity: Pick<ClientUsage, 'app' | 'platform'>,
  webVersion: string,
  readNativeInfo: () => Promise<{ version: string }>,
  signal?: AbortSignal
): Promise<ClientUsage> {
  signal?.throwIfAborted()
  let nativeVersion: string | null = null
  if (identity.app === 'android') {
    try {
      nativeVersion = (await readNativeInfo()).version || null
    } catch {
      // A missing bridge is supported, but failed metadata collection remains observable.
      if (!signal?.aborted) console.warn('Native app version is unavailable for session metadata.')
    }
  }
  signal?.throwIfAborted()
  return { ...identity, webVersion, nativeVersion }
}

/** Report on confirmed session opening/foregrounding. Cancellation prevents late account-switch writes. */
export async function reportClientUsage(signal?: AbortSignal): Promise<void> {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const identity = classifyClient(isNative(), isDesktopHost(), standalone, navigator.userAgent)
  const reportSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(8_000)])
    : AbortSignal.timeout(8_000)
  const usage = await collectClientUsage(identity, __APP_VERSION__, () => NativeApp.getInfo(), reportSignal)
  await apiFetch('/api/client-usage', {
    method: 'POST',
    body: JSON.stringify(usage),
    signal: reportSignal
  })
}
