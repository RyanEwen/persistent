/** Aggregate administration and session client identity. No personal content leaves these endpoints. */
import { z } from 'zod'

export const clientAppSchema = z.enum(['browser', 'pwa', 'android', 'windows'])
export const clientPlatformSchema = z.enum(['android', 'ios', 'windows', 'macos', 'linux', 'unknown'])
const versionSchema = z.string().trim().min(1).max(64)

/** Current app reports its identity on opening/foregrounding, scoped to its authenticated session. */
export const clientUsageSchema = z.object({
  app: clientAppSchema,
  platform: clientPlatformSchema,
  webVersion: versionSchema,
  nativeVersion: versionSchema.nullable()
}).strict()
export type ClientUsage = z.infer<typeof clientUsageSchema>

const count = z.number().int().nonnegative()
export const adminMetricSchema = z.object({ key: z.string(), count, users: count })
export type AdminMetric = z.infer<typeof adminMetricSchema>

export const adminStatsSchema = z.object({
  generatedAt: z.string().datetime(),
  activeDays: z.union([z.literal(7), z.literal(30)]),
  users: z.object({ total: count, active: count, inactive: count, day: count, week: count, month: count, newMonth: count, withReminders: count }),
  reminders: z.array(adminMetricSchema),
  types: z.array(adminMetricSchema),
  schedules: z.array(adminMetricSchema),
  occurrences: z.array(adminMetricSchema),
  collaboration: z.array(adminMetricSchema),
  clients: z.array(z.object({
    app: clientAppSchema.nullable(),
    platform: clientPlatformSchema.nullable(),
    webVersion: versionSchema.nullable(),
    nativeVersion: versionSchema.nullable(),
    users: count,
    sessions: count
  }))
})
export type AdminStats = z.infer<typeof adminStatsSchema>

/** Stable metric keys and user-facing labels, shared by the aggregates and dashboard. */
export const reminderStatLabels = {
  total: 'All definitions', reminders: 'Reminders', enabled: 'Enabled reminders', paused: 'Paused reminders',
  notes: 'Notes', noteChecklists: 'Checklist notes', persistent: 'Persistent notifications',
  nags: 'Repeating nags', alarms: 'Alarms', alarmEscalation: 'Alarm escalation', emailEscalation: 'Email escalation'
} as const
export const occurrenceStatLabels = {
  waiting: 'Waiting for completion', snoozed: 'Currently snoozed', notifiedMonth: 'First notified in last 30 days',
  completedMonth: 'Completed in last 30 days', escalatedMonth: 'Alarm escalated in last 30 days',
  emailedMonth: 'Email escalation attempts in last 30 days'
} as const
export const collaborationStatLabels = {
  shares: 'Accepted shares', invitations: 'Pending share invitations', assignments: 'Assignments',
  pendingAssignments: 'Pending assignments'
} as const
