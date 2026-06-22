/**
 * TanStack Query hooks for occurrences (the "due now" feed) + ack/snooze.
 * Ack/snooze trigger a server-side cross-device dismiss and use the offline-aware
 * mutation defaults (queued + replayed on reconnect); WS events refresh here.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Occurrence } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { mutationKeys, queryKeys } from '../lib/queryClient.js'

export function useActiveOccurrences() {
  return useQuery({
    queryKey: queryKeys.occurrencesActive,
    queryFn: async () =>
      (await apiFetch<{ occurrences: Occurrence[] }>('/api/occurrences?scope=active')).occurrences
  })
}

export function useUpcomingOccurrences() {
  return useQuery({
    queryKey: queryKeys.occurrencesUpcoming,
    queryFn: async () =>
      (await apiFetch<{ occurrences: Occurrence[] }>('/api/occurrences?scope=upcoming')).occurrences
  })
}

export function usePastOccurrences() {
  return useQuery({
    queryKey: queryKeys.occurrencesHistory,
    queryFn: async () =>
      (await apiFetch<{ occurrences: Occurrence[] }>('/api/occurrences?scope=history')).occurrences
  })
}

export function useAckOccurrence() {
  return useMutation<unknown, Error, { id: string; arg: void }>({ mutationKey: mutationKeys.ackOccurrence })
}

export function useSnoozeOccurrence() {
  return useMutation<unknown, Error, { id: string; arg: number }>({ mutationKey: mutationKeys.snoozeOccurrence })
}

/** Silence an escalation alarm: stop the alarm but keep the reminder nagging. */
export function useSilenceOccurrence() {
  return useMutation<unknown, Error, { id: string; arg: void }>({ mutationKey: mutationKeys.silenceOccurrence })
}
