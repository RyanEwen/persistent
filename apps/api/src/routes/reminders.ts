/**
 * Reminder CRUD. Every query is scoped to the authenticated user. On
 * create/update we immediately materialize near-future occurrences so the next
 * firing doesn't wait for the 5-minute materialization cycle, and fire any that
 * are already due (e.g. a one-shot left at its "now" default) so it nags right
 * away rather than waiting for the tick.
 */
import { Router } from 'express'
import { reminderInputSchema } from '@persistent/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, notFound } from '../lib/http-error.js'
import { toReminder } from '../lib/serializers.js'
import { isStaleWrite } from '../lib/conflict.js'
import { materializeReminder, fireDueForReminder } from '../lib/scheduler.js'
import { broadcast } from '../lib/realtime.js'
import { dispatchToUser, nudgeNativeSync } from '../lib/delivery/index.js'
import { logger } from '../lib/logger.js'

export const remindersRouter = Router()
remindersRouter.use(requireUser)

remindersRouter.get('/', async (request, response) => {
  const userId = requireUserId(request)
  const reminders = await prisma.reminder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    // Latest occurrence at/before now, so the list can show its state (done,
    // snoozed, escalated, missed, due). Future PENDING ones are ignored here.
    include: {
      occurrences: {
        where: { scheduledFor: { lte: new Date() } },
        orderBy: { scheduledFor: 'desc' },
        take: 1
      }
    }
  })
  response.json({ reminders: reminders.map((r) => toReminder(r, r.occurrences[0] ?? null)) })
})

remindersRouter.post('/', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = reminderInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid reminder.')

  const reminder = await prisma.reminder.create({
    data: { ...toReminderData(parsed.data), userId }
  })

  await materializeForUser(reminder.id, userId)
  // Fire right away if the first instant is already due (e.g. a one-shot left at
  // its "now" default), so the reminder nags immediately instead of after a tick.
  await fireDueForReminder(reminder.id)
  broadcast(userId, { type: 'reminder.changed', reminderId: reminder.id })
  void nudgeNativeSync(userId).catch((error) => logger.warn('sync nudge failed', { error: String(error) }))
  response.status(201).json({ reminder: toReminder(reminder) })
})

remindersRouter.put('/:id', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = reminderInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid reminder.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')

  // Last-edit-wins: ignore an offline edit that predates the stored version (a
  // newer edit already landed). The stale client reconciles on its next refetch.
  const clientEditedAt = typeof request.body?.clientEditedAt === 'string' ? request.body.clientEditedAt : null
  if (isStaleWrite(clientEditedAt, existing.updatedAt)) {
    response.json({ reminder: toReminder(existing) })
    return
  }

  const reminder = await prisma.reminder.update({
    where: { id: existing.id },
    data: toReminderData(parsed.data)
  })

  // Drop not-yet-fired occurrences so the new schedule re-materializes cleanly.
  await prisma.reminderOccurrence.deleteMany({ where: { reminderId: reminder.id, status: 'PENDING' } })
  await materializeForUser(reminder.id, userId)
  await fireDueForReminder(reminder.id)
  broadcast(userId, { type: 'reminder.changed', reminderId: reminder.id })
  void nudgeNativeSync(userId).catch((error) => logger.warn('sync nudge failed', { error: String(error) }))
  response.json({ reminder: toReminder(reminder) })
})

remindersRouter.delete('/:id', async (request, response) => {
  const userId = requireUserId(request)
  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')

  // Collect occurrences that may have a live notification/alarm so we can clear
  // them everywhere after the cascade delete.
  const active = await prisma.reminderOccurrence.findMany({
    where: { reminderId: existing.id, userId, status: { in: ['FIRED', 'ESCALATED', 'SNOOZED'] } },
    select: { id: true }
  })

  await prisma.reminder.delete({ where: { id: existing.id } })
  broadcast(userId, { type: 'reminder.changed', reminderId: existing.id })

  // Dismiss any active notification/alarm for the deleted reminder on every device.
  for (const occurrence of active) {
    broadcast(userId, { type: 'dismiss', occurrenceId: occurrence.id })
    await dispatchToUser(userId, { type: 'dismiss', occurrenceId: occurrence.id }).catch((error) =>
      logger.warn('delete dismiss dispatch failed', { error: String(error), occurrenceId: occurrence.id })
    )
  }
  // Nudge native devices to drop the deleted reminder's future on-device alarms.
  void nudgeNativeSync(userId).catch((error) => logger.warn('sync nudge failed', { error: String(error) }))
  response.json({ ok: true })
})

// Shared column mapping for create + update. Excludes userId: create adds it, and
// update must never reassign ownership.
function toReminderData(
  input: ReturnType<typeof reminderInputSchema.parse>
): Omit<Prisma.ReminderUncheckedCreateInput, 'userId'> {
  return {
    title: input.title,
    details: input.details ?? null,
    category: input.category,
    categoryData: input.categoryData as Prisma.InputJsonValue,
    schedule: input.schedule as unknown as Prisma.InputJsonValue,
    persistence: input.persistence,
    soundIntervalSeconds: input.soundIntervalSeconds,
    shadeProminence: input.shadeProminence,
    escalateAfterMinutes: input.escalateAfterMinutes,
    escalateAtTime: input.escalateAtTime,
    escalateEmail: input.escalateEmail,
    escalateEmailMessage: input.escalateEmailMessage,
    escalateEmailAfterMinutes: input.escalateEmailAfterMinutes,
    active: input.active,
    startDate: input.startDate,
    endDate: input.endDate
  }
}

async function materializeForUser(reminderId: string, userId: string): Promise<void> {
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } })
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } })
  if (reminder && user) await materializeReminder(reminder, user.timeZone)
}
