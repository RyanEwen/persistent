/** Activate pending assignments when the invited address signs in. */
import { assignmentCreateSchema } from '@persistent/shared'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { toReminderData } from './reminder-data.js'
import { ensureUnscheduledFiring, fireDueForReminder, materializeReminder } from './scheduler.js'
import { broadcast } from './realtime.js'
import { nudgeNativeSync } from './delivery/index.js'
import { logger } from './logger.js'

/** Create the assignee's first firing and refresh their signed-in clients. */
export async function activateAssignment(reminderId: string, recipientId: string): Promise<void> {
  const reminder = await prisma.reminder.findFirst({ where: { id: reminderId, userId: recipientId } })
  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { timeZone: true } })
  if (!reminder || !recipient) return

  if ((reminder.schedule as { kind?: string }).kind === 'none') {
    await ensureUnscheduledFiring(reminder, reminder.createdAt)
  }
  await materializeReminder(reminder, recipient.timeZone)
  await fireDueForReminder(reminder.id)
  broadcast(recipientId, { type: 'reminder.changed', reminderId })
  void nudgeNativeSync(recipientId).catch((error) =>
    logger.warn('assignment native sync failed', { error: String(error), reminderId })
  )
}

/** Claim only a verified email's pending drafts; the reminder belongs to that account. */
export async function claimPendingAssignments(user: { id: string; email: string }): Promise<void> {
  const pending = await prisma.reminderAssignment.findMany({
    where: { recipientEmail: { equals: user.email, mode: 'insensitive' }, state: 'PENDING' }
  })

  for (const assignment of pending) {
    const parsed = assignmentCreateSchema.safeParse({ recipientEmail: assignment.recipientEmail, reminder: assignment.draft })
    if (!parsed.success) {
      logger.error('invalid pending assignment draft', { assignmentId: assignment.id })
      continue
    }

    const result = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.reminderAssignment.updateMany({
        where: { id: assignment.id, state: 'PENDING', recipientEmail: assignment.recipientEmail },
        data: { state: 'ACTIVE', recipientId: user.id, acceptedAt: new Date() }
      })
      if (claimed.count === 0) return null

      const reminder = await transaction.reminder.create({
        data: { ...toReminderData(parsed.data.reminder), userId: user.id }
      })
      await transaction.reminderAssignment.update({
        where: { id: assignment.id },
        data: { reminderId: reminder.id, draft: Prisma.DbNull }
      })
      return reminder.id
    })
    if (!result) continue

    await activateAssignment(result, user.id)
    broadcast(assignment.creatorId, { type: 'assignment.changed' })
  }
}
