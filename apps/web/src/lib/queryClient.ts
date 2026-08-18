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
import {
  extractErrorMessage,
  withTodoItem,
  withTodoOrder,
  type AddTodoItemInput,
  type CheckItemInput,
  type HideCheckedInput,
  type Occurrence,
  type Reminder,
  type ReminderInput,
  type ReorderTodoItemsInput
} from '@persistent/shared'
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
  silenceOccurrence: ['occurrences', 'silence'] as const,
  checkOccurrenceItem: ['occurrences', 'check'] as const,
  checkReminderItem: ['reminders', 'check'] as const,
  addTodoItem: ['reminders', 'add-item'] as const,
  reorderTodoItems: ['reminders', 'reorder-items'] as const,
  hideCheckedItems: ['reminders', 'hide-checked'] as const
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
    type: input.type ?? 'NONE',
    typeData: input.typeData ?? {},
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
    // A create/update never carries ticks: a new note starts unticked, and an
    // edit's optimistic row is replaced by the server's on settle. (The server
    // also clears these whenever the reminder is not a note.)
    checkedItemIds: [],
    // Likewise not a form field: a new checklist starts expanded, and an edit's
    // optimistic row carries the stored value over (see the update default).
    hideCheckedItems: false,
    lastOccurrence: null,
    createdAt: now,
    updatedAt: now
  }
}

interface RemindersSnapshot {
  previous?: Reminder[]
}

interface OccurrencesSnapshot {
  previous?: Occurrence[]
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
  // Declared up here, not inline: an inline arrow annotating its variables param
  // as `unknown` pins the mutation's inferred variables type to `unknown` too.
  const rollbackOccurrences = (_e: unknown, _v: unknown, ctx: OccurrencesSnapshot | undefined) => {
    if (ctx?.previous) queryClient.setQueryData(queryKeys.occurrencesActive, ctx.previous)
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
        // Ticks are carried over rather than rebuilt from the input, which has
        // none: editing a note's title must not blink its checked items away and
        // back when the server's row lands. This mirrors the server's own rule —
        // ticks survive while it is still a note, and are cleared once it isn't.
        (previous ?? []).map((r) =>
          r.id === id
            ? {
                ...optimisticReminder(input, id),
                checkedItemIds: input.schedule.kind === 'never' ? r.checkedItemIds : [],
                // Carried over unconditionally: the server's update never touches
                // this column, so rebuilding the row from the form must not blink
                // a collapsed checklist open until the real row lands.
                hideCheckedItems: r.hideCheckedItems
              }
            : r
        )
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

  // A note's checklist ticks the *reminder*, not an occurrence — a note has none
  // (docs/notification-behavior.md §7). Same optimistic treatment as the
  // occurrence toggle, and the same idempotent per-item replay offline.
  queryClient.setMutationDefaults(mutationKeys.checkReminderItem, {
    mutationFn: ({ id, arg }: { id: string; arg: CheckItemInput }) =>
      apiFetch(`/api/reminders/${id}/check`, { method: 'POST', body: JSON.stringify(arg) }),
    onMutate: async ({ id, arg }: { id: string; arg: CheckItemInput }): Promise<RemindersSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders })
      const previous = reminders()
      queryClient.setQueryData<Reminder[]>(queryKeys.reminders, (list) =>
        (list ?? []).map((reminder) => {
          if (reminder.id !== id) return reminder
          const checked = reminder.checkedItemIds.filter((itemId) => itemId !== arg.itemId)
          return { ...reminder, checkedItemIds: arg.checked ? [...checked, arg.itemId] : checked }
        })
      )
      return { previous }
    },
    onError: rollback,
    onSettled: invalidateReminders
  })

  // Adding an item from a card writes the reminder's *definition*, so it applies to
  // the same cache the checklist is drawn from. Optimistic because the add row stays
  // open for the next line: the item the user just typed has to be on the list
  // before they type the next one, or they lose their place. `withTodoItem` skips an
  // id the list already carries, mirroring the endpoint, so a replay can't double it.
  queryClient.setMutationDefaults(mutationKeys.addTodoItem, {
    mutationFn: ({ id, arg }: { id: string; arg: AddTodoItemInput }) =>
      apiFetch(`/api/reminders/${id}/items`, { method: 'POST', body: JSON.stringify(arg) }),
    onMutate: async ({ id, arg }: { id: string; arg: AddTodoItemInput }): Promise<RemindersSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders })
      const previous = reminders()
      queryClient.setQueryData<Reminder[]>(queryKeys.reminders, (list) =>
        (list ?? []).map((reminder) =>
          reminder.id === id ? { ...reminder, typeData: withTodoItem(reminder.typeData, arg) } : reminder
        )
      )
      return { previous }
    },
    onError: rollback,
    onSettled: invalidateReminders
  })

  // Reordering writes the definition too, and applies to the same cache the checklist
  // is drawn from. The card has already shown the new order under the user's finger, so
  // this is what stops it flicking back to the old one before the server answers.
  // `withTodoOrder` is the same ranking rule the endpoint applies, so the optimistic
  // result and the stored one agree.
  queryClient.setMutationDefaults(mutationKeys.reorderTodoItems, {
    mutationFn: ({ id, arg }: { id: string; arg: ReorderTodoItemsInput }) =>
      apiFetch(`/api/reminders/${id}/items/order`, { method: 'POST', body: JSON.stringify(arg) }),
    onMutate: async ({ id, arg }: { id: string; arg: ReorderTodoItemsInput }): Promise<RemindersSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders })
      const previous = reminders()
      queryClient.setQueryData<Reminder[]>(queryKeys.reminders, (list) =>
        (list ?? []).map((reminder) =>
          reminder.id === id ? { ...reminder, typeData: withTodoOrder(reminder.typeData, arg.itemIds) } : reminder
        )
      )
      return { previous }
    },
    onError: rollback,
    onSettled: invalidateReminders
  })

  // Collapsing a checklist is a view state, but a *shared* one — it is stored so
  // it follows the user between devices. Optimistic for the same reason ticking
  // is: the button sits right next to the checkboxes and must respond instantly.
  queryClient.setMutationDefaults(mutationKeys.hideCheckedItems, {
    mutationFn: ({ id, arg }: { id: string; arg: HideCheckedInput }) =>
      apiFetch(`/api/reminders/${id}/hide-checked`, { method: 'POST', body: JSON.stringify(arg) }),
    onMutate: async ({ id, arg }: { id: string; arg: HideCheckedInput }): Promise<RemindersSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders })
      const previous = reminders()
      queryClient.setQueryData<Reminder[]>(queryKeys.reminders, (list) =>
        (list ?? []).map((reminder) => (reminder.id === id ? { ...reminder, hideCheckedItems: arg.hidden } : reminder))
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

  // Ticking a checklist item is the one occurrence action the user does *while
  // deciding*, often several in a row, so it updates the cache optimistically —
  // a checkbox that waits for a round trip feels broken. Queued offline it
  // replays as an idempotent per-item toggle (see checkItemInputSchema).
  queryClient.setMutationDefaults(mutationKeys.checkOccurrenceItem, {
    mutationFn: ({ id, arg }: { id: string; arg: CheckItemInput }) =>
      apiFetch(`/api/occurrences/${id}/check`, { method: 'POST', body: JSON.stringify(arg) }),
    onMutate: async ({ id, arg }: { id: string; arg: CheckItemInput }): Promise<OccurrencesSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.occurrencesActive })
      const previous = queryClient.getQueryData<Occurrence[]>(queryKeys.occurrencesActive)
      queryClient.setQueryData<Occurrence[]>(queryKeys.occurrencesActive, (list) =>
        (list ?? []).map((occurrence) => {
          if (occurrence.id !== id) return occurrence
          const checked = occurrence.checkedItemIds.filter((itemId) => itemId !== arg.itemId)
          return { ...occurrence, checkedItemIds: arg.checked ? [...checked, arg.itemId] : checked }
        })
      )
      return { previous }
    },
    onError: rollbackOccurrences,
    onSettled: invalidateOccurrences
  })
}
