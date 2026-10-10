/** Public, account-independent app catalog with a bundled and last-good offline fallback. */
import { useQuery } from '@tanstack/react-query'
import manifest from '../../../desktop/external/promo/Assets/PromotedApps/apps.json'
import { CATALOG_BASE_URL, parseCatalog } from '../../../desktop/external/promo/catalog.js'
import { apiFetch } from '../lib/apiClient.js'
import { queryKeys } from '../lib/queryClient.js'

const CACHE_KEY = 'persistent-promoted-apps-v1'

/** A damaged or unavailable local cache must never prevent opening Settings. */
function readCatalog() {
  try {
    const saved = localStorage.getItem(CACHE_KEY)
    if (saved) return parseCatalog(JSON.parse(saved))
  } catch { /* Use bundled content if storage is blocked or obsolete. */ }
  return parseCatalog(manifest)
}

/** Refresh only while the catalog page is open; failures retain the displayed fallback. */
export function usePromotedApps() {
  return useQuery({
    queryKey: queryKeys.promotedApps,
    meta: { startupOptional: true, silentError: true },
    initialData: readCatalog,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ signal }) => {
      // Public GitHub content must never receive the signed-in account's credentials.
      const controller = new AbortController()
      const cancel = () => controller.abort()
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      const timeout = setTimeout(cancel, 10_000)
      try {
        const value = await apiFetch<unknown>(`${CATALOG_BASE_URL}apps.json`, {
          credentials: 'omit',
          signal: controller.signal,
          cache: 'no-store'
        })
        const apps = parseCatalog(value)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ apps }))
        } catch { /* The page still works when storage is full or unavailable. */ }
        return apps
      } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', cancel)
      }
    }
  })
}
