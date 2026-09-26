/**
 * Persist the TanStack Query cache to localStorage so owned reminders and
 * firings render offline (e.g. the Capacitor WebView with no network), and
 * queued mutations survive a reload. Auth, share, and assignment queries are excluded;
 * occurrence feeds are saved with recipient firings removed.
 *
 * The cache holds DTOs shaped by the version that wrote them, so it is busted on
 * every app version: restoring rows from an older release into newer components
 * feeds them fields that release didn't have. `category` -> `type` did exactly
 * that — the restored reminders had no `type`, so the type-icon lookup returned
 * `undefined` and rendering it crashed the view. History was the lasting casualty,
 * because its query is only observed on that page: invalidation doesn't refetch a
 * query nobody is watching, so the bad rows were re-rendered (and re-crashed) on
 * every visit instead of being replaced. One refetch after an update is a cheap
 * price for never shipping an old cache into new code.
 */
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { serializeOwnedCache } from './serializeOwnedCache.js'

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'persistent-query-cache',
  serialize: serializeOwnedCache
})

// A revoked share must not remain readable from an offline cache.
const EXCLUDED_PREFIXES = ['auth', 'shares', 'assignments']

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  // Any cache written by a different build is discarded rather than restored.
  buster: __APP_VERSION__,
  // Keep cached data usable across long offline stretches; must be <= the
  // query gcTime so entries aren't garbage-collected before this expires.
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && !EXCLUDED_PREFIXES.includes(String(query.queryKey[0]))
  }
}
