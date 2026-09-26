/** Reminder sharing queries and online mutations. Access changes require a server response. */
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ReminderShare, SharedReminder, ShareInput } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { queryClient, queryKeys } from '../lib/queryClient.js'

export function useReceivedShares() {
  return useQuery({
    queryKey: queryKeys.receivedShares,
    queryFn: async () => (await apiFetch<{ reminders: SharedReminder[] }>('/api/shares/received')).reminders
  })
}

export function useShareRecipients() {
  return useQuery({
    queryKey: ['shares', 'recipients'],
    queryFn: async () => (await apiFetch<{ recipients: string[] }>('/api/shares/recipients')).recipients
  })
}

export function useReminderShares(reminderId: string) {
  return useQuery({
    queryKey: ['shares', reminderId],
    queryFn: async () => (await apiFetch<{ shares: ReminderShare[] }>(`/api/shares/${reminderId}`)).shares,
    enabled: Boolean(reminderId)
  })
}

export function useSaveReminderShare(reminderId: string) {
  return useMutation({
    mutationFn: (input: ShareInput) =>
      apiFetch<{ share: ReminderShare }>(`/api/shares/${reminderId}`, { method: 'PUT', body: JSON.stringify(input) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['shares', reminderId] })
      void queryClient.invalidateQueries({ queryKey: ['shares', 'recipients'] })
    }
  })
}

export function useRemoveReminderShare(reminderId: string) {
  return useMutation({
    mutationFn: (share: ReminderShare) => apiFetch<{ ok: true }>(
      share.pending
        ? `/api/shares/${reminderId}/invitations/${encodeURIComponent(share.email)}`
        : `/api/shares/${reminderId}/${share.recipientId}`,
      { method: 'DELETE' }
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shares', reminderId] })
  })
}

export function useLeaveSharedReminder() {
  return useMutation({
    mutationFn: (reminderId: string) => apiFetch<{ ok: true }>(`/api/shares/received/${reminderId}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.receivedShares })
  })
}

export function useResendShareInvitation(reminderId: string) {
  return useMutation({
    mutationFn: (email: string) => apiFetch<{ ok: true }>(
      `/api/shares/${reminderId}/invitations/${encodeURIComponent(email)}/resend`,
      { method: 'POST' }
    )
  })
}
