/** Account-scoped announcements; fresh unread state stays out of offline storage. */
import { useMutation, useQuery } from '@tanstack/react-query'
import { announcementListSchema } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { mutationKeys, queryKeys } from '../lib/queryClient.js'

/** Fetch unread announcements only after the account's network gate is open. */
export function useAnnouncements() {
  return useQuery({
    queryKey: queryKeys.announcements,
    meta: { startupOptional: true },
    queryFn: async () => announcementListSchema.parse(await apiFetch('/api/announcements')).announcements
  })
}

/** Queue a durable dismissal with the same account binding as other app writes. */
export function useViewAnnouncement() {
  return useMutation<unknown, Error, { id: string }>({ mutationKey: mutationKeys.viewAnnouncement })
}
