/** Creator progress and assignee ownership, loaded through authenticated HTTP. */
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Assignment, AssignmentCreateInput, ReceivedAssignment } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { queryClient, queryKeys } from '../lib/queryClient.js'

export function useSentAssignments() {
  return useQuery({
    queryKey: queryKeys.assignmentsSent,
    queryFn: async () => (await apiFetch<{ assignments: Assignment[] }>('/api/assignments/sent')).assignments
  })
}

export function useReceivedAssignments() {
  return useQuery({
    queryKey: queryKeys.assignmentsReceived,
    queryFn: async () => (await apiFetch<{ assignments: ReceivedAssignment[] }>('/api/assignments/received')).assignments
  })
}

export function useCreateAssignment() {
  return useMutation({
    mutationFn: (input: AssignmentCreateInput) => apiFetch<{ assignmentId: string; invitationFailed: boolean }>(
      '/api/assignments',
      { method: 'POST', body: JSON.stringify(input) }
    ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentsSent })
  })
}

export function useResendAssignmentInvitation() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/api/assignments/sent/${id}/resend`, { method: 'POST' })
  })
}
