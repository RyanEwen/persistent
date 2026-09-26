/** Invalidate the creator's read-only progress view after an assignee acts. */
import { prisma } from './prisma.js'
import { broadcast } from './realtime.js'

export async function broadcastAssignmentProgress(reminderId: string): Promise<void> {
  const assignment = await prisma.reminderAssignment.findUnique({
    where: { reminderId },
    select: { id: true, creatorId: true }
  })
  if (!assignment) return
  const latestDone = await prisma.reminderOccurrence.findFirst({
    where: { reminderId, status: 'ACKNOWLEDGED', acknowledgedAt: { not: null } },
    orderBy: { acknowledgedAt: 'desc' },
    select: { acknowledgedAt: true }
  })
  if (latestDone?.acknowledgedAt) {
    await prisma.reminderAssignment.update({
      where: { id: assignment.id },
      data: { lastCompletedAt: latestDone.acknowledgedAt }
    })
  }
  broadcast(assignment.creatorId, { type: 'assignment.changed' })
}
