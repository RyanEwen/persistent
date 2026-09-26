/** Contracts for reminders created for one assignee and monitored by their creator. */
import { z } from 'zod'
import { reminderInputSchema, occurrenceStatusSchema } from './reminders.js'

export const assignmentCreateSchema = z.object({
  recipientEmail: z.string().trim().toLowerCase().email().max(254),
  reminder: reminderInputSchema
})
export type AssignmentCreateInput = z.input<typeof assignmentCreateSchema>

export const assignmentStateSchema = z.enum(['PENDING', 'ACTIVE', 'DECLINED'])

export const assignmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  recipientEmail: z.string(),
  state: assignmentStateSchema,
  reminderId: z.string().nullable(),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  declinedAt: z.string().datetime().nullable(),
  lastCompletedAt: z.string().datetime().nullable(),
  recentFirings: z.array(z.object({
    id: z.string(),
    scheduledFor: z.string().datetime(),
    status: occurrenceStatusSchema,
    acknowledgedAt: z.string().datetime().nullable()
  }))
})
export type Assignment = z.infer<typeof assignmentSchema>

export const receivedAssignmentSchema = z.object({
  reminderId: z.string(),
  creatorName: z.string()
})
export type ReceivedAssignment = z.infer<typeof receivedAssignmentSchema>
