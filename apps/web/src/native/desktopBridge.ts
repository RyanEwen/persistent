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
 * The channel is small on purpose. Host -> page carries `back` (the flyout's
 * title-bar button, which walks the app's screen hierarchy rather than browser
 * history); page -> host carries `close` (Back ran out of hierarchy). Nothing
 * streams state to the host: it has no surface that needs it, and a second copy of
 * "what is due" would be a second source of truth that can disagree.
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

