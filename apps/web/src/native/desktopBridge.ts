/**
 * Bridge to the Windows desktop host (`apps/desktop`), which loads this same
 * hosted bundle in a WebView2 inside a tray flyout.
 *
 * There are now three hosts for one bundle — browser, Capacitor/Android, and this
 * one — and none of them can be compiled in, so every difference is runtime
 * feature detection. Keep `isDesktopHost()` distinct from `isNative()`
 * (`alarmBridge.ts`): Capacitor is not available here, so `isNative()` is false in
 * the desktop host, and a check that conflates the two will silently do the wrong
 * thing on one of them.
 *
 * The channel carries exactly one message, web -> host: how many occurrences are
 * nagging, so the tray icon can badge a count. The host deliberately does not
 * fetch that itself — this page already holds the session, the caches and the live
 * `/ws` socket, so duplicating it natively would mean a second source of truth
 * that can disagree.
 */

interface WebView2Bridge {
  postMessage(message: unknown): void
}

declare global {
  interface Window {
    chrome?: { webview?: WebView2Bridge }
  }
}

/** True when running inside the Windows tray app's WebView2. */
export function isDesktopHost(): boolean {
  return typeof window !== 'undefined' && typeof window.chrome?.webview?.postMessage === 'function'
}

/**
 * Whether this host can show OS notifications that survive the app being closed.
 *
 * The desktop host shows none at all: it is a viewing and acting surface, not a
 * nag surface (see `docs/desktop-architecture.md`). WebView2 may still *report*
 * the Push API as present, so a capability check alone would offer the user a
 * notification toggle that silently does nothing.
 */
export function hostSupportsPush(): boolean {
  return !isDesktopHost()
}

let lastSent = ''

/**
 * Tell the host how many occurrences are nagging. Cheap and idempotent: repeated
 * identical counts are dropped, so this can be called from a render pass.
 */
export function reportBadge(count: number, escalated: boolean): void {
  if (!isDesktopHost()) return
  const payload = { type: 'badge' as const, count, escalated }
  const key = `${count}:${escalated}`
  if (key === lastSent) return
  lastSent = key
  try {
    window.chrome!.webview!.postMessage(payload)
  } catch {
    // A dead bridge costs the user a badge, not their reminders — the flyout
    // itself keeps working, so this must never surface as an error.
    lastSent = ''
  }
}
