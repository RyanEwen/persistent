/**
 * Persist the TanStack Query cache to localStorage so reminders/occurrences
 * render offline (e.g. the Capacitor WebView with no network) and queued
 * mutations survive a reload. Auth/push queries are excluded — those should
 * always be re-validated against the server, never restored stale.
 */
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'persistent-query-cache'
})

const EXCLUDED_PREFIXES = ['auth', 'push']

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  // Keep cached data usable across long offline stretches; must be <= the
  // query gcTime so entries aren't garbage-collected before this expires.
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && !EXCLUDED_PREFIXES.includes(String(query.queryKey[0]))
  }
}
