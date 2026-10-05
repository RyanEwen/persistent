/** Resolve online identity first, falling back to saved local identity only for connection failures. */
import { authStateSchema, type SessionUser } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'

export interface LocalSession {
  user: SessionUser | null
  offline: boolean
}

/** Probe even while domain writes are paused. HTTP errors and invalid responses never authorize fallback. */
export async function loadSession(savedUser: SessionUser | null, online = navigator.onLine, signal?: AbortSignal): Promise<LocalSession> {
  if (!online) return { user: savedUser, offline: true }
  try {
    const result = authStateSchema.parse(await apiFetch('/api/auth/me', {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)
    }))
    return { ...result, offline: false }
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')) {
      return { user: savedUser, offline: true }
    }
    throw error
  }
}
