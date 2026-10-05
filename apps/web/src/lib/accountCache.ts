/** Bind persisted queries and queued writes to the last server-confirmed account. */
import type { PersistedClient } from '@tanstack/react-query-persist-client'

/** Add the owner to the already-filtered cache without retaining credentials. */
export function serializeAccountCache(raw: string, accountId: string | null): string {
  return JSON.stringify({ ...JSON.parse(raw), accountId })
}

/** Reject unowned or mismatched caches, including their queued mutations, before hydration. */
export function deserializeAccountCache(raw: string, accountId: string | null): PersistedClient {
  const saved = JSON.parse(raw) as PersistedClient & { accountId?: string }
  if (!accountId || saved.accountId !== accountId) {
    return { timestamp: 0, buster: '', clientState: { queries: [], mutations: [] } }
  }
  return saved
}
