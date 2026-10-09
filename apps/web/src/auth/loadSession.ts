/** Resolve online identity first, falling back to saved local identity only for connection failures. */
import { authStateSchema, type SessionUser } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'

// The normal probe has eight seconds. One fresh, shorter request gives a resumed
// WebView a chance to recover without doubling the wait on a broken connection.
const SESSION_PROBE_TIMEOUTS_MS = [8_000, 3_000] as const

export interface LocalSession {
  user: SessionUser | null
  offline: boolean
}

/**
 * Probe while domain writes are paused, retrying a connection failure once.
 * Each attempt gets a fresh timeout signal; caller cancellation, HTTP failures
 * and invalid responses never authorize saved-account access or another attempt.
 */
export async function loadSession(savedUser: SessionUser | null, online = navigator.onLine, signal?: AbortSignal): Promise<LocalSession> {
  signal?.throwIfAborted()
  if (!online) return { user: savedUser, offline: true }

  for (const [attempt, timeoutMs] of SESSION_PROBE_TIMEOUTS_MS.entries()) {
    try {
      const timeout = AbortSignal.timeout(timeoutMs)
      const result = authStateSchema.parse(await apiFetch('/api/auth/me', {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      }))
      signal?.throwIfAborted()
      return { ...result, offline: false }
    } catch (error) {
      // Sign-out/account changes can abort a request while the browser reports a
      // transport error. The caller's cancellation always wins over fallback.
      signal?.throwIfAborted()
      const connectionFailure = error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')
      if (!connectionFailure) throw error

      const retrying = attempt < SESSION_PROBE_TIMEOUTS_MS.length - 1
      // Record only the failure category, never account details or credentials.
      console.warn(retrying
        ? 'Session connection check failed; retrying with a fresh request.'
        : 'Session connection checks failed; using saved offline access.', { reason: error.name })
    }
  }

  return { user: savedUser, offline: true }
}
