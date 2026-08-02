/**
 * Reminder CRUD. Every query is scoped to the authenticated user. On
 * create/update we immediately materialize near-future occurrences so the next
 * firing doesn't wait for the 5-minute materialization cycle, and fire any that
 * are already due (e.g. a one-shot left at its "now" default) so it nags right
 * away rather than waiting for the tick.
 */
import { Router } from 'express'
import { checkItemInputSchema, reminderInputSchema, todoItems, type TypeData } from '@persistent/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, notFound } from '../lib/http-error.js'
import { toReminder } from '../lib/serializers.js'
import { isStaleWrite } from '../lib/conflict.js'
import { scheduleTransition } from '../lib/schedule-transition.js'
import { materializeReminder, fireDueForReminder, ensureUnscheduledFiring } from '../lib/scheduler.js'
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

  // An unscheduled reminder's one firing is minted here rather than by
  // materialization (see `ensureUnscheduledFiring`), anchored to the instant the
  // user created it.
  if (parsed.data.schedule.kind === 'none') await ensureUnscheduledFiring(reminder, reminder.createdAt)
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
  // Only moving between a real schedule, no schedule and a note touches an
  // existing firing; see `scheduleTransition` for why each direction does what
  // it does.
  const beforeKind = (existing.schedule as unknown as { kind?: string }).kind ?? ''
  const transition = scheduleTransition(beforeKind, parsed.data.schedule.kind)
  if (transition === 'retire') {
    const retired = await prisma.reminderOccurrence.findMany({
      where: { reminderId: reminder.id, userId, status: { in: ['FIRED', 'ESCALATED', 'SNOOZED'] } },
      select: { id: true }
    })
    if (retired.length > 0) {
      await prisma.reminderOccurrence.deleteMany({ where: { userId, id: { in: retired.map((o) => o.id) } } })
      logger.info('retired live firings on schedule change', {
        reminderId: reminder.id,
        count: retired.length,
        // Which of the two retiring edits this was: gaining a real schedule, or
        // becoming a note. Both drop firings, for different reasons.
        from: beforeKind,
        to: parsed.data.schedule.kind
      })
      // Clear the live notification/alarm on every device, same as a delete does.
      for (const occurrence of retired) {
        broadcast(userId, { type: 'dismiss', occurrenceId: occurrence.id })
        await dispatchToUser(userId, { type: 'dismiss', occurrenceId: occurrence.id }).catch((error) =>
          logger.warn('retire dismiss dispatch failed', { error: String(error), occurrenceId: occurrence.id })
        )
      }
    }
  }
  // Anchored to the edit, not to `createdAt`: this firing exists because the user
  // just took the schedule off, so dating it back to when the reminder was made
  // would put it before the reminder's own start date.
  if (transition === 'mint') await ensureUnscheduledFiring(reminder, reminder.updatedAt)
  await materializeForUser(reminder.id, userId)
  await fireDueForReminder(reminder.id)
  broadcast(userId, { type: 'reminder.changed', reminderId: reminder.id })
  void nudgeNativeSync(userId).catch((error) => logger.warn('sync nudge failed', { error: String(error) }))
  response.json({ reminder: toReminder(reminder) })
})

/**
 * Tick or untick one item on a **note's** checklist.
 *
 * The mirror of `POST /api/occurrences/:id/check`, and deliberately a separate
 * endpoint rather than a flag on that one: they write different rows because the
 * ticks mean different things. A firing's ticks record what was done *that time*;
 * a note has no firings, so its ticks are simply the state of the list.
 *
 * Restricted to notes for exactly that reason. A scheduled reminder's checklist is
 * ticked per firing, and letting the definition carry ticks too would mean two
 * places holding "what is checked" with nothing to say which one is right.
 */
remindersRouter.post('/:id/check', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = checkItemInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid checklist item.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')
  if (existing.type !== 'TODO') throw badRequest('This reminder has no checklist.')
  const kind = (existing.schedule as unknown as { kind?: string }).kind
  if (kind !== 'never') throw badRequest('Only a note is ticked off directly; a scheduled reminder is ticked per firing.')

  const items = todoItems((existing.typeData ?? {}) as TypeData)
  if (!items.some((item) => item.id === parsed.data.itemId)) throw notFound('Checklist item not found.')

  // One atomic statement, for the same reason as the occurrence route: working
  // down a list means several taps in quick succession, each its own request, and
  // a read-modify-write loses every tick but the last. `-` then `||` also makes
  // re-ticking idempotent, so an offline replay can't duplicate an id.
  const { itemId, checked } = parsed.data
  await prisma.$executeRaw`
    UPDATE "Reminder"
    SET "checkedItems" = CASE
      WHEN ${checked}::boolean THEN ("checkedItems" - ${itemId}::text) || jsonb_build_array(${itemId}::text)
      ELSE "checkedItems" - ${itemId}::text
    END
    WHERE "id" = ${existing.id} AND "userId" = ${userId}
  `
  const updated = await prisma.reminder.findFirstOrThrow({ where: { id: existing.id, userId } })

  // WS only. A note notifies nobody, so there is no notification to re-render and
  // nothing for a device to re-sync — this just lets the user's other open clients
  // converge on the same list.
  broadcast(userId, { type: 'reminder.changed', reminderId: updated.id })
  response.json({ reminder: toReminder(updated) })
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
    type: input.type,
    typeData: input.typeData as Prisma.InputJsonValue,
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
    endDate: input.endDate,
    // Ticks against the definition only mean something for a note. The moment one
    // gains a schedule its firings own the checked state again (each starting
    // blank), so leaving these would strand ticks that nothing reads — and hand
    // them back, weeks stale, if it ever became a note again.
    ...(input.schedule.kind === 'never' ? {} : { checkedItems: [] })
  }
}

async function materializeForUser(reminderId: string, userId: string): Promise<void> {
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } })
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } })
  if (reminder && user) await materializeReminder(reminder, user.timeZone)
}
