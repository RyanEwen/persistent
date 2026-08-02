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

/**
 * Messages the host sends us. Anything unrecognised is ignored.
 *
 * `navigate` carries an in-app path, not a URL: it comes from clicking a Windows
 * toast, and the host deliberately does not navigate the WebView itself. Doing so
 * would reload the app and throw away where the user was — the same reason `back`
 * is a message rather than `CoreWebView2.GoBack()`.
 *
 * `checkForUpdate` says the flyout was just reopened, so this page may have been
 * frozen for days (`lib/swUpdate.ts`). It is a nudge, not an instruction: the page
 * decides whether to act, exactly as it does for `back`.
 */
type HostMessage = { type: 'back' } | { type: 'navigate'; path: string } | { type: 'checkForUpdate' }

/** True when running inside the Windows tray app's WebView2. */
export function isDesktopHost(): boolean {
  return typeof window !== 'undefined' && typeof window.chrome?.webview?.postMessage === 'function'
}

/**
 * Whether *this page* can subscribe to Web Push on this host.
 *
 * False in the desktop host, for two independent reasons — either alone is fatal:
 *
 * - WebView2 refuses `Notification.requestPermission()` unless the native host
 *   handles `PermissionRequested`, so the subscription can never be granted. The
 *   Push API may still *report* as present, which is why a capability check alone
 *   (`pushSupported()`) is not enough and this exists.
 * - The WebView is suspended whenever the flyout is hidden, freezing the page and
 *   its service worker. Even a granted subscription could only ever deliver while
 *   the flyout was already open, which is precisely when a notification is
 *   pointless.
 *
 * The tray app's Windows notifications are the answer on that host, and they are
 * raised by the host process from its own connection, not from here — turned on in
 * the tray app's own settings (`docs/desktop-architecture.md`).
 */
export function hostSupportsPush(): boolean {
  return !isDesktopHost()
}

/**
 * Subscribe to messages from the host. Returns an unsubscribe function; a no-op
 * on every other host.
 *
 * Two messages: `back`, from the flyout's title-bar back button, and `navigate`,
 * from a click on a Windows toast. In both cases the host says what happened and
 * the page decides what it means — the hierarchy that Back walks is a web concern
 * (`useNativeBack.ts`), and so is what a route does.
 *
 * `path` is validated here rather than trusted: it must be a root-relative,
 * single-slash path. A host message is not a privileged caller either, and letting
 * `//evil.example` or a full URL through would turn this into an open redirect
 * driven by whatever was in a notification.
 */
export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  if (!isDesktopHost()) return () => {}
  const bridge = window.chrome!.webview!
  const listener = (event: { data: unknown }) => {
    const data = event.data
    if (typeof data !== 'object' || data === null) return
    const type = (data as { type?: unknown }).type
    if (type === 'back') handler({ type: 'back' })
    if (type === 'checkForUpdate') handler({ type: 'checkForUpdate' })
    if (type === 'navigate') {
      const path = (data as { path?: unknown }).path
      if (typeof path === 'string' && /^\/[^/]/.test(path)) handler({ type: 'navigate', path })
    }
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

