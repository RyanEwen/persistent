/**
 * Keeps long-lived PWA and desktop pages current on visibility, timer and host resume.
 * Worker activation checks the loaded build through the same hook as sibling apps,
 * instead of reloading unconditionally. Offline checks remain silent.
 */
import { registerSW } from 'virtual:pwa-register'
import { checkForWebUpdate } from './webUpdate.js'
import { onHostMessage } from '../native/desktopBridge.js'

/**
 * Floor between checks. Becoming visible is a frequent event, every tray-flyout
 * open, every alt-tab, and a request per open would be a lot of traffic for
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
  const now = Date.now()
  if (!force && now - lastCheck < MIN_GAP_MS) return
  lastCheck = now
  // Offline, or the server is briefly down: there is nothing to do about it and
  // nothing to tell the user, so this stays quiet. The next check is minutes away.
  void registration?.update().catch(() => {})
  void checkForWebUpdate()
}

/** Register the service worker and keep it looking for new builds. */
export function startServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onNeedReload() {
      void checkForWebUpdate()
    },
    onRegisteredSW(_swUrl, existing) {
      registration = existing
      check(true)
    },
    onRegisterError() {
      void checkForWebUpdate()
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
  // above enough, but that link is the one thing here that cannot be verified
  // outside Windows, and the cost of the page being wrong about it is a tray app
  // that silently never updates. So the host also says so outright on resume.
  // Double-firing is harmless: this is the same idempotent check.
  onHostMessage((message) => {
    if (message.type === 'checkForUpdate') check(true)
  })
}
