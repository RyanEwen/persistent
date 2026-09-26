/** Access checks for shared reminder actions; an explicit grant permits collaboration. */
import { prisma } from './prisma.js'
import { broadcast } from './realtime.js'
import type { ReminderOccurrence } from '@prisma/client'
import { occurrenceForActor } from './recipient-alert-state.js'
import { nudgeNativeSync } from './delivery/index.js'
import { logger } from './logger.js'
import { broadcastAssignmentProgress } from './assignment-progress.js'

/** Find a firing the actor owns or may act on through a reminder share. */
export async function actionableOccurrence(id: string, actorId: string) {
  return prisma.reminderOccurrence.findFirst({
    where: {
      id,
      OR: [
        { userId: actorId },
        { reminder: { shares: { some: { recipientId: actorId } } } }
      ]
    },
    include: { reminder: true }
  })
}

/** Apply the actor's own snooze and escalation state after access was checked. */
export async function personalOccurrence<T extends ReminderOccurrence>(occurrence: T, actorId: string): Promise<T> {
  if (occurrence.userId === actorId) return occurrence
  const state = await prisma.recipientAlertState.findUnique({
    where: { occurrenceId_recipientId: { occurrenceId: occurrence.id, recipientId: actorId } }
  })
  return occurrenceForActor(occurrence, actorId, state)
}

/** Owner and current recipients who must receive a shared Done or definition change. */
export async function participantIds(reminderId: string, ownerId: string): Promise<string[]> {
  const shares = await prisma.reminderShare.findMany({
    where: { reminderId, reminder: { userId: ownerId } },
    select: { recipientId: true }
  })
  return [ownerId, ...shares.map((share) => share.recipientId)]
}

/** Find a reminder the actor owns or has explicit edit permission for. */
export async function editableReminder(id: string, actorId: string) {
  return prisma.reminder.findFirst({
    where: {
      id,
      OR: [
        { userId: actorId },
        { shares: { some: { recipientId: actorId } } }
      ]
    }
  })
}

/** Find a reminder that the actor may complete or change checklist progress on. */
export async function actionableReminder(id: string, actorId: string) {
  return prisma.reminder.findFirst({
    where: {
      id,
      OR: [
        { userId: actorId },
        { shares: { some: { recipientId: actorId } } }
      ]
    }
  })
}

/** Refresh recipient web views and native alarms after a shared definition or firing changes. */
export async function broadcastSharedChange(reminderId: string, ownerId: string) {
  await broadcastAssignmentProgress(reminderId)
  const shares = await prisma.reminderShare.findMany({
    where: { reminderId, reminder: { userId: ownerId } },
    select: { recipientId: true }
  })
  for (const share of shares) {
    broadcast(share.recipientId, { type: 'reminder.changed', reminderId })
    void nudgeNativeSync(share.recipientId).catch((error) =>
      logger.warn('shared reminder sync nudge failed', { error: String(error), reminderId })
    )
  }
}
