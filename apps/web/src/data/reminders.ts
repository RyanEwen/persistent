/**
 * TanStack Query hooks for reminders. Mutations use the offline-aware defaults
 * registered in queryClient.ts (optimistic cache update + replay-on-reconnect);
 * live WS events also invalidate the list, so the UI stays current without
 * polling.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import type { CheckItemInput, Reminder, ReminderInput } from '@persistent/shared'
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
