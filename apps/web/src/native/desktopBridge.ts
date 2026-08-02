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
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

declare global {
  interface Window {
    chrome?: { webview?: WebView2Bridge }
  }
}

/** Messages the host sends us. Anything unrecognised is ignored. */
type HostMessage = { type: 'back' }

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

/**
 * Subscribe to messages from the host. Returns an unsubscribe function; a no-op
 * on every other host.
 *
 * Currently one message: `back`, from the flyout's title-bar back button. The
 * host deliberately does not try to navigate the page itself — the hierarchy that
 * Back walks is a web concern (`useNativeBack.ts`), and the Android client
 * already implements it. The button just says "the user pressed back".
 */
export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  if (!isDesktopHost()) return () => {}
  const bridge = window.chrome!.webview!
  const listener = (event: { data: unknown }) => {
    const data = event.data
    if (typeof data !== 'object' || data === null) return
    const type = (data as { type?: unknown }).type
    if (type === 'back') handler({ type: 'back' })
  }
  bridge.addEventListener('message', listener)
  return () => bridge.removeEventListener('message', listener)
}

/**
 * Ask the host to close the flyout — the desktop equivalent of Android's Back
 * leaving the app, used when a Back press has nowhere left to go.
 */
export function requestClose(): void {
  if (!isDesktopHost()) return
  try {
    window.chrome!.webview!.postMessage({ type: 'close' })
  } catch {
    // Worst case the flyout stays open; the user can click away from it.
  }
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
