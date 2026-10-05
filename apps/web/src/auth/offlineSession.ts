/** Saved account identity for local offline access, never a credential or server authorization. */
import { sessionUserSchema, type SessionUser } from '@persistent/shared'

export const OFFLINE_SESSION_KEY = 'persistent-offline-session'
export const QUERY_CACHE_KEY = 'persistent-query-cache'
export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

/** Read a recently confirmed identity. Invalid or expired profiles cannot unlock cached data. */
export function readOfflineUser(storage: Pick<Storage, 'getItem'>, now = Date.now()): SessionUser | null {
  try {
    const raw = storage.getItem(OFFLINE_SESSION_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { user?: unknown; confirmedAt?: unknown }
    if (typeof saved.confirmedAt !== 'number' || saved.confirmedAt > now || now - saved.confirmedAt > OFFLINE_MAX_AGE) return null
    const parsed = sessionUserSchema.safeParse(saved.user)
    return parsed.success ? parsed.data : null
  } catch {
    // A corrupt or unavailable local profile grants no offline access.
    return null
  }
}

/** Save only public profile fields after the server confirms the session; sign-out removes both stores. */
export function saveOfflineUser(storage: Storage, user: SessionUser | null, now = Date.now()): void {
  // Fail closed if a quota or storage error prevents recording the new owner.
  // Otherwise new account data could be serialized under the previous profile.
  storage.removeItem(OFFLINE_SESSION_KEY)
  if (user) {
    storage.setItem(OFFLINE_SESSION_KEY, JSON.stringify({ user, confirmedAt: now }))
  } else {
    storage.removeItem(QUERY_CACHE_KEY)
  }
}
