/**
 * TanStack Query hooks for reminders. Mutations use the offline-aware defaults
 * registered in queryClient.ts (optimistic cache update + replay-on-reconnect);
 * live WS events also invalidate the list, so the UI stays current without
 * polling.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  AddTodoItemInput,
  CheckItemInput,
  HideCheckedInput,
  Reminder,
  ReminderInput,
  ReorderTodoItemsInput
} from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { mutationKeys, queryKeys } from '../lib/queryClient.js'

export function useReminders() {
  return useQuery({
    queryKey: queryKeys.reminders,
    queryFn: async () => (await apiFetch<{ reminders: Reminder[] }>('/api/reminders')).reminders
  })
}

export function useCreateReminder() {
  return useMutation<{ reminder: Reminder }, Error, ReminderInput>({ mutationKey: mutationKeys.createReminder })
}

export function useUpdateReminder() {
  return useMutation<{ reminder: Reminder }, Error, { id: string; input: ReminderInput; editedAt?: string }>({
    mutationKey: mutationKeys.updateReminder
  })
}

export function useDeleteReminder() {
  return useMutation<unknown, Error, string>({ mutationKey: mutationKeys.deleteReminder })
}

/**
 * Tick or untick one item on a **note's** checklist. Notes have no occurrence, so
 * unlike every other checklist this writes the reminder itself — see
 * `docs/notification-behavior.md` §7 and the route's own comment.
 */
export function useCheckReminderItem() {
  return useMutation<unknown, Error, { id: string; arg: CheckItemInput }>({
    mutationKey: mutationKeys.checkReminderItem
  })
}

/**
 * Append one item to a reminder's checklist from a card, instead of opening the
 * editor for it. Items belong to the reminder, so this writes the definition —
 * every later firing carries the new item, and it starts unticked.
 */
export function useAddTodoItem() {
  return useMutation<unknown, Error, { id: string; arg: AddTodoItemInput }>({
    mutationKey: mutationKeys.addTodoItem
  })
}

/**
 * Reorder a reminder's checklist from a card. Sent as the full set of ids in their new
 * order and applied by the server as a *ranking*, so a reorder that lands late can
 * reshuffle but never drop an item added in the meantime.
 */
export function useReorderTodoItems() {
  return useMutation<unknown, Error, { id: string; arg: ReorderTodoItemsInput }>({
    mutationKey: mutationKeys.reorderTodoItems
  })
}

/**
 * Collapse or expand the ticked items on a reminder's checklist. Stored on the
 * reminder rather than in `settings/useSettings`, which is per-device — the point
 * of this one is that a list stays the way you left it on your other device.
 */
export function useSetHideCheckedItems() {
  return useMutation<unknown, Error, { id: string; arg: HideCheckedInput }>({
    mutationKey: mutationKeys.hideCheckedItems
  })
}
