/** Keep received firings out of the persisted offline cache without losing owned firings. */
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import type { Occurrence, OccurrenceList, Reminder } from '@persistent/shared'

/** Only reminder definitions in this query belong to the signed-in account. */
function ownedReminderIds(client: PersistedClient): Set<string> {
  const reminders = client.clientState.queries.find((query) => query.queryKey[0] === 'reminders')
  const data = reminders?.state.data
  if (!Array.isArray(data)) return new Set()
  return new Set((data as Reminder[]).map((reminder) => reminder.id))
}

/** Strip received firings before writing an occurrence feed to localStorage. */
function ownedOccurrenceData(data: unknown, ids: Set<string>): unknown {
  if (Array.isArray(data)) {
    return (data as Occurrence[]).filter((occurrence) => ids.has(occurrence.reminderId))
  }

  // History is an infinite query; keep its page cursors intact for refetching.
  if (data && typeof data === 'object' && 'pages' in data && Array.isArray(data.pages)) {
    return {
      ...data,
      pages: (data.pages as OccurrenceList[]).map((page) => ({
        ...page,
        occurrences: page.occurrences.filter((occurrence) => ids.has(occurrence.reminderId))
      }))
    }
  }

  // Unknown occurrence shapes should never become an offline access path.
  return undefined
}

/** Keep the live query cache intact while serializing only owner-owned firings. */
export function serializeOwnedCache(client: PersistedClient): string {
  const ids = ownedReminderIds(client)
  return JSON.stringify({
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => {
        if (query.queryKey[0] !== 'occurrences') return query
        return {
          ...query,
          state: { ...query.state, data: ownedOccurrenceData(query.state.data, ids) }
        }
      })
    }
  })
}
