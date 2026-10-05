/** Keep cached writes paused until the server confirms which account owns the session. */
import { onlineManager } from '@tanstack/react-query'

/** Install once before mounting QueryClientProvider, replacing automatic reconnect replay. */
export function initializeSessionNetwork(): void {
  onlineManager.setOnline(false)
  onlineManager.setEventListener(() => {
    const suspend = () => onlineManager.setOnline(false)
    window.addEventListener('offline', suspend)
    // AuthProvider handles reconnect. Merely finding a network must not replay
    // writes from a saved account into a different or expired server session.
    return () => window.removeEventListener('offline', suspend)
  })
}

/** Only a successful server session check opens the domain query/mutation network gate. */
export function setSessionNetwork(confirmed: boolean): void {
  onlineManager.setOnline(confirmed && navigator.onLine !== false)
}
