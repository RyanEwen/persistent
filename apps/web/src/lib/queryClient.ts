/**
 * Shared TanStack Query client. Live updates arrive over WebSocket and
 * invalidate these caches — components must not poll.
 */
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
})

export const queryKeys = {
  auth: ['auth'] as const,
  reminders: ['reminders'] as const,
  occurrencesActive: ['occurrences', 'active'] as const,
  occurrencesUpcoming: ['occurrences', 'upcoming'] as const,
  pushConfig: ['push', 'config'] as const
}
