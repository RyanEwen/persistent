/** Online-only administrator snapshot. Never persisted or replayed as an offline mutation. */
import { useQuery } from '@tanstack/react-query'
import { adminStatsSchema } from '@persistent/shared'
import { useAuth } from '../auth/useAuth.js'
import { apiFetch } from '../lib/apiClient.js'

export function useAdminStats(activeDays: 7 | 30) {
  const { user, offline } = useAuth()
  return useQuery({
    queryKey: ['admin', user?.id, 'stats', activeDays],
    queryFn: async ({ signal }) => adminStatsSchema.parse(await apiFetch(`/api/admin/stats?activeDays=${activeDays}`, { signal })),
    enabled: Boolean(user?.isAdmin) && !offline,
    retry: false,
    gcTime: 0,
    staleTime: 0
  })
}
