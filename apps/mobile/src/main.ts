/**
 * Native bootstrap. Bundled into the wrapped web app and invoked once at
 * startup; a no-op on the web (where the service worker handles notifications).
 *
 * Wire-up: import and call `initNative()` from the web app's entrypoint behind
 * a native check, or include this module in the Capacitor build. See README.md.
 */
import { initNative, syncAlarms, ackOccurrence } from './native-sync.js'

export { initNative, syncAlarms, ackOccurrence }

void initNative()
