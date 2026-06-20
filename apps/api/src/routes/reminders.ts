/**
 * Reminder CRUD. Every query is scoped to the authenticated user. On
 * create/update we immediately materialize near-future occurrences so the next
 * firing doesn't wait for the 5-minute materialization cycle.
 */
import { Router } from 'express'
import { reminderInputSchema } from '@persistent/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, notFound } from '../lib/http-error.js'
import { toReminder } from '../lib/serializers.js'
import { materializeReminder } from '../lib/scheduler.js'
import { broadcast } from '../lib/realtime.js'

export const remindersRouter = Router()
remindersRouter.use(requireUser)

remindersRouter.get('/', async (request, response) => {
  const userId = requireUserId(request)
  const reminders = await prisma.reminder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  })
  response.json({ reminders: reminders.map(toReminder) })
})

remindersRouter.post('/', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = reminderInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid reminder.')

  const reminder = await prisma.reminder.create({
    data: { ...toReminderData(parsed.data), userId }
  })

  await materializeForUser(reminder.id, userId)
  broadcast(userId, { type: 'reminder.changed', reminderId: reminder.id })
  response.status(201).json({ reminder: toReminder(reminder) })
})

remindersRouter.put('/:id', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = reminderInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid reminder.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')

  const reminder = await prisma.reminder.update({
    where: { id: existing.id },
    data: toReminderData(parsed.data)
  })

  // Drop not-yet-fired occurrences so the new schedule re-materializes cleanly.
  await prisma.reminderOccurrence.deleteMany({ where: { reminderId: reminder.id, status: 'PENDING' } })
  await materializeForUser(reminder.id, userId)
  broadcast(userId, { type: 'reminder.changed', reminderId: reminder.id })
  response.json({ reminder: toReminder(reminder) })
})

remindersRouter.delete('/:id', async (request, response) => {
  const userId = requireUserId(request)
  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')
  await prisma.reminder.delete({ where: { id: existing.id } })
  broadcast(userId, { type: 'reminder.changed', reminderId: existing.id })
  response.json({ ok: true })
})

function toReminderData(input: ReturnType<typeof reminderInputSchema.parse>): Prisma.ReminderUncheckedCreateInput {
  return {
    title: input.title,
    details: input.details ?? null,
    category: input.category,
    categoryData: input.categoryData as Prisma.InputJsonValue,
    schedule: input.schedule as unknown as Prisma.InputJsonValue,
    persistence: input.persistence,
    soundIntervalSeconds: input.soundIntervalSeconds,
    escalateAfterMinutes: input.escalateAfterMinutes,
    escalateContactEmail: input.escalateContactEmail,
    escalateToOwnDevices: input.escalateToOwnDevices,
    active: input.active,
    startDate: input.startDate,
    endDate: input.endDate,
    // userId filled by caller
    userId: ''
  }
}

async function materializeForUser(reminderId: string, userId: string): Promise<void> {
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } })
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } })
  if (reminder && user) await materializeReminder(reminder, user.timeZone)
}
