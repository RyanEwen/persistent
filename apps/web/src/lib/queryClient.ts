/**
 * Shared TanStack Query client + offline support.
 *
 * Live updates arrive over WebSocket and invalidate these caches — components
 * must not poll. For offline use the query cache is persisted to localStorage
 * (see persistQuery.ts) and mutations are registered with *defaults* here so a
 * mutation queued while offline can be replayed after a reload + reconnect
 * (`resumePausedMutations`). Reminder writes also apply optimistically so the UI
 * reflects them immediately, even with no network.
 */
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query'
import { extractErrorMessage, type Reminder, type ReminderInput } from '@persistent/shared'
import { apiFetch } from './apiClient.js'
import { notify } from './toast.js'

// Persisted entries are dropped once garbage-collected, so keep them around long
// enough to outlive offline stretches (must be >= the persister maxAge).
const OFFLINE_GC_TIME = 1000 * 60 * 60 * 24 * 7 // 7 days

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: OFFLINE_GC_TIME,
      refetchOnWindowFocus: false,
      retry: 1
    }
  },
  // Surface background failures cleanly instead of swallowing them. Offline-paused
  // mutations don't error, so this only fires on genuine failures.
  queryCache: new QueryCache({
    onError: (error) => notify(extractErrorMessage(error, "Couldn't load data."), 'danger')
  }),
  mutationCache: new MutationCache({
    onError: (error) => notify(extractErrorMessage(error, 'Something went wrong.'), 'danger')
  })
})

export const queryKeys = {
  auth: ['auth'] as const,
  reminders: ['reminders'] as const,
  occurrencesActive: ['occurrences', 'active'] as const,
  occurrencesUpcoming: ['occurrences', 'upcoming'] as const,
  occurrencesHistory: ['occurrences', 'history'] as const,
  pushConfig: ['push', 'config'] as const
}

export const mutationKeys = {
  createReminder: ['reminders', 'create'] as const,
  updateReminder: ['reminders', 'update'] as const,
  deleteReminder: ['reminders', 'delete'] as const,
  ackOccurrence: ['occurrences', 'ack'] as const,
  snoozeOccurrence: ['occurrences', 'snooze'] as const,
  silenceOccurrence: ['occurrences', 'silence'] as const
}

let tempCounter = 0
function tempId(): string {
  tempCounter += 1
  return `temp-${Date.now()}-${tempCounter}`
}

/** Build a stand-in Reminder for the optimistic cache; replaced on refetch. */
function optimisticReminder(input: ReminderInput, id = tempId()): Reminder {
  const now = new Date().toISOString()
  return {
    id,
    title: input.title,
    details: input.details ?? null,
    category: input.category ?? 'NONE',
    categoryData: input.categoryData ?? {},
    schedule: input.schedule,
    persistence: input.persistence ?? 'PERSISTENT',
    soundIntervalSeconds: input.soundIntervalSeconds ?? null,
    shadeProminence: input.shadeProminence ?? 'INHERIT',
    escalateAfterMinutes: input.escalateAfterMinutes ?? null,
    escalateAtTime: input.escalateAtTime ?? null,
    escalateEmail: input.escalateEmail ?? null,
    escalateEmailMessage: input.escalateEmailMessage ?? null,
    escalateEmailAfterMinutes: input.escalateEmailAfterMinutes ?? null,
    active: input.active ?? true,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    lastOccurrence: null,
    createdAt: now,
    updatedAt: now
  }
}

interface RemindersSnapshot {
  previous?: Reminder[]
}

/**
 * Register mutation defaults so queued-while-offline mutations carry their own
 * mutationFn (needed to resume after a reload) and reminder writes update the
 * cache optimistically. Call once at startup, before rendering.
 */
export function registerMutationDefaults(): void {
  const reminders = () => queryClient.getQueryData<Reminder[]>(queryKeys.reminders)
  const invalidateReminders = () => queryClient.invalidateQueries({ queryKey: queryKeys.reminders })
  const rollback = (_e: unknown, _v: unknown, ctx: RemindersSnapshot | undefined) => {
    if (ctx?.previous) queryClient.setQueryData(queryKeys.reminders, ctx.previous)
  }

  queryClient.setMutationDefaults(mutationKeys.createReminder, {
    mutationFn: (input: ReminderInput) =>
      apiFetch<{ reminder: Reminder }>('/api/reminders', { method: 'POST', body: JSON.stringify(input) }),
    onMutate: async (input: ReminderInput): Promise<RemindersSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders })
      const previous = reminders()
      queryClient.setQueryData<Reminder[]>(queryKeys.reminders, [optimisticReminder(input), ...(previous ?? [])])
      return { previous }
    },
    onError: rollback,
    onSettled: invalidateReminders
  })

  queryClient.setMutationDefaults(mutationKeys.updateReminder, {
    // clientEditedAt (captured at submit, preserved while queued offline) lets the
    // server apply last-edit-wins so a late-replayed stale edit can't clobber a
    // newer one.
    mutationFn: ({ id, input, editedAt }: { id: string; input: ReminderInput; editedAt?: string }) =>
      apiFetch<{ reminder: Reminder }>(`/api/reminders/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...input, clientEditedAt: editedAt ?? new Date().toISOString() })
      }),
    onMutate: async ({ id, input }: { id: string; input: ReminderInput; editedAt?: string }): Promise<RemindersSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders })
      const previous = reminders()
      queryClient.setQueryData<Reminder[]>(
        queryKeys.reminders,
        (previous ?? []).map((r) => (r.id === id ? optimisticReminder(input, id) : r))
      )
      return { previous }
    },
    onError: rollback,
    onSettled: invalidateReminders
  })

  queryClient.setMutationDefaults(mutationKeys.deleteReminder, {
    mutationFn: (id: string) => apiFetch(`/api/reminders/${id}`, { method: 'DELETE' }),
    onMutate: async (id: string): Promise<RemindersSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders })
      const previous = reminders()
      queryClient.setQueryData<Reminder[]>(
        queryKeys.reminders,
        (previous ?? []).filter((r) => r.id !== id)
      )
      return { previous }
    },
    onError: rollback,
    onSettled: invalidateReminders
  })

  const invalidateOccurrences = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.occurrencesActive })
    void queryClient.invalidateQueries({ queryKey: queryKeys.occurrencesUpcoming })
  }

  queryClient.setMutationDefaults(mutationKeys.ackOccurrence, {
    mutationFn: ({ id }: { id: string; arg: void }) => apiFetch(`/api/occurrences/${id}/ack`, { method: 'POST' }),
    onSettled: invalidateOccurrences
  })

  queryClient.setMutationDefaults(mutationKeys.snoozeOccurrence, {
    mutationFn: ({ id, arg }: { id: string; arg: number }) =>
      apiFetch(`/api/occurrences/${id}/snooze`, { method: 'POST', body: JSON.stringify({ minutes: arg }) }),
    onSettled: invalidateOccurrences
  })

  queryClient.setMutationDefaults(mutationKeys.silenceOccurrence, {
    mutationFn: ({ id }: { id: string; arg: void }) => apiFetch(`/api/occurrences/${id}/silence`, { method: 'POST' }),
    onSettled: invalidateOccurrences
  })
}
