/** Account transitions and local access policy shared by startup, reconnect and sign-in. */
import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryClient.js'
import { notifyHostSignedOut } from '../native/desktopBridge.js'
import { AlarmPlugin, isNative } from '../native/alarmBridge.js'
import { readOfflineUser, saveOfflineUser } from './offlineSession.js'
import { setSessionNetwork } from './sessionNetwork.js'
import { ownedOccurrenceData } from '../lib/serializeOwnedCache.js'
import type { LocalSession } from './loadSession.js'

/**
 * Drop the signed-out user's cached data, keeping the auth query itself.
 *
 * `queryClient.clear()` would be the obvious call and is a trap: it removes every
 * query *including* `auth`, while `AuthProvider`'s `useQuery` is still mounted and
 * observing it. The observer is left watching a query that no longer exists, so the
 * next `setQueryData(auth, ...)`, i.e. the very next sign-in, creates a *new* query
 * the observer never sees. The session is established server-side but the UI stays
 * on the sign-in screen forever, which only looks like a hung request.
 *
 * Removing everything except `auth` drops the departing user's reminders (including
 * from the persisted cache, so they aren't readable offline) while leaving the auth
 * observer bound to a live query.
 */
export function dropSignedOutData(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.auth[0] })
  queryClient.getMutationCache().clear()
}

/**
 * Clear native alerts belonging to the account being signed out.
 *
 * Android alarms and Windows notifications outlive the web session that armed
 * them. Without this cleanup, a reminder belonging to the previous account can
 * still appear after sign-out. Both host calls are no-ops in a normal browser.
 */
export async function clearNativeAlerts(): Promise<void> {
  notifyHostSignedOut()
  if (isNative()) {
    // Local cleanup is best-effort during sign-out. A native bridge failure must
    // not leave the authenticated web session or cached account data in place.
    await AlarmPlugin.cancelAll().catch(() => {
      console.warn('Could not clear local Android alerts during account cleanup.')
    })
  }
}

/** Reconcile account ownership before allowing saved mutations to leave this device. */
export async function acceptSession(queryClient: QueryClient, session: LocalSession): Promise<LocalSession> {
  setSessionNetwork(false)
  const previous = readOfflineUser(window.localStorage)
  if (!session.offline && previous?.id !== session.user?.id) {
    await queryClient.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
    dropSignedOutData(queryClient)
    await clearNativeAlerts()
  }
  if (!session.offline) {
    try {
      saveOfflineUser(window.localStorage, session.user)
    } catch {
      console.warn('Offline account storage is unavailable; offline reopening cannot be saved.')
    }
  } else {
    // In-memory feeds can contain received firings after losing connectivity.
    // Apply the same ownership filter used by the persisted offline copy.
    const reminders = queryClient.getQueryData<Array<{ id: string }>>(queryKeys.reminders) ?? []
    const ownedIds = new Set(reminders.map((reminder) => reminder.id))
    await queryClient.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
    void queryClient.resetQueries({ queryKey: ['shares'] })
    void queryClient.resetQueries({ queryKey: ['assignments'] })
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ['occurrences'] })) {
      queryClient.setQueryData(query.queryKey, ownedOccurrenceData(query.state.data, ownedIds))
    }
  }
  setSessionNetwork(Boolean(session.user) && !session.offline)
  return session
}
