/**
 * TanStack Query hooks for occurrences (the "due now" feed) + ack/snooze.
 * Ack/snooze trigger a server-side cross-device dismiss and use the offline-aware
 * mutation defaults (queued + replayed on reconnect); WS events refresh here.
 */
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type { CheckItemInput, Occurrence, OccurrenceList } from '@persistent/shared'
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

/**
 * History, a page at a time. Unlike active/upcoming this feed only grows — every
 * confirmed firing stays forever — so it is the one list that pages rather than
 * loading whole. The cursor is the last occurrence id of the previous page.
 *
 * Pages accumulate in the cache (and so in the persisted offline copy), which is
 * the point: the user keeps what they scrolled, and a fresh visit costs one page
 * instead of the entire history.
 */
export function usePastOccurrences() {
  return useInfiniteQuery({
    queryKey: queryKeys.occurrencesHistory,
    queryFn: async ({ pageParam }) =>
      apiFetch<OccurrenceList>(
        pageParam ? `/api/occurrences?scope=history&cursor=${encodeURIComponent(pageParam)}` : '/api/occurrences?scope=history'
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined
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

/**
 * Tick / untick one checklist item on one firing. Ticking everything does not
 * confirm the firing — Done still does that (docs/notification-behavior.md §1a).
 */
export function useCheckOccurrenceItem() {
  return useMutation<unknown, Error, { id: string; arg: CheckItemInput }>({
    mutationKey: mutationKeys.checkOccurrenceItem
  })
}
