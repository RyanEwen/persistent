/**
 * Keeps a long-lived install on the current build.
 *
 * The service worker is registered with `registerType: 'autoUpdate'`, so once a
 * new one is *found* it takes over and reloads the page on its own. Finding it is
 * the weak part: the browser only looks on a navigation, and on its own ~24h
 * timer. A page that is opened once and then lives for days never navigates again,
 * so it can sit on a stale bundle indefinitely — and this app has two hosts shaped
 * exactly like that:
 *
 * - an installed PWA the user leaves open;
 * - the Windows tray app, whose WebView navigates once at startup, is never
 *   rebuilt, and is *suspended* whenever the flyout is hidden — which freezes the
 *   24h timer too, so even waiting does not help.
 *
 * So this asks explicitly, on the occasions a PWA normally would: whenever the
 * page becomes visible again, and on an interval while it stays visible. Asking is
 * all it does — `registration.update()` only checks; if there is something new,
 * autoUpdate still owns the swap and the reload.
 */
import { registerSW } from 'virtual:pwa-register'
import { onHostMessage } from '../native/desktopBridge.js'

/**
 * Floor between checks. Becoming visible is a frequent event — every tray-flyout
 * open, every alt-tab — and a request per open would be a lot of traffic for
 * something that changes on deploys.
 */
const MIN_GAP_MS = 15 * 60_000

/** How often to ask while the page just sits there visible. */
const POLL_MS = 60 * 60_000

let registration: ServiceWorkerRegistration | undefined
let lastCheck = 0

/**
 * Ask the browser to look for a new service worker.
 *
 * `force` skips the floor, for the one caller that is not a routine visibility
 * change: the desktop host telling us it just resumed a page that may have been
 * frozen for days.
 */
function check(force = false): void {
  if (!registration) return
  const now = Date.now()
  if (!force && now - lastCheck < MIN_GAP_MS) return
  lastCheck = now
  // Offline, or the server is briefly down: there is nothing to do about it and
  // nothing to tell the user, so this stays quiet. The next check is minutes away.
  void registration.update().catch(() => {})
}

/** Register the service worker and keep it looking for new builds. */
export function startServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, existing) {
      registration = existing
      // Registering has just done a check, so don't let the first visibility
      // change fire another one straight away.
      lastCheck = Date.now()
    }
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })

  setInterval(() => {
    if (document.visibilityState === 'visible') check()
  }, POLL_MS)

  // Belt and braces for the desktop host. Collapsing a WebView2 controller is
  // supposed to drive `document.visibilityState`, which would make the listener
  // above enough — but that link is the one thing here that cannot be verified
  // outside Windows, and the cost of the page being wrong about it is a tray app
  // that silently never updates. So the host also says so outright on resume.
  // Double-firing is harmless: this is the same idempotent check.
  onHostMessage((message) => {
    if (message.type === 'checkForUpdate') check(true)
  })
}
