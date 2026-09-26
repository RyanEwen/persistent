/** Create an assignee-owned reminder and expose creator-only progress. */
import { Router } from 'express'
import { assignmentCreateSchema, type Assignment } from '@persistent/shared'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, notFound, tooManyRequests, HttpError } from '../lib/http-error.js'
import { toReminderData } from '../lib/reminder-data.js'
import { activateAssignment } from '../lib/assignments.js'
import { buildAssignmentInvitationEmail } from '../lib/share-invitation-email.js'
import { clientOrigins } from '../lib/env.js'
import { isEmailConfigured, sendCloudflareEmail } from '../lib/cloudflare-email.js'
import { rateLimit } from '../lib/rate-limit.js'
import { logger } from '../lib/logger.js'
import { broadcast } from '../lib/realtime.js'

export const assignmentsRouter = Router()
assignmentsRouter.use(requireUser)

/** Address suggestions are shared with the Share dialog, scoped to this creator. */
async function rememberRecipient(creatorId: string, email: string): Promise<void> {
  await prisma.shareRecipient.upsert({
    where: { ownerId_email: { ownerId: creatorId, email } },
    create: { ownerId: creatorId, email },
    update: { lastSharedAt: new Date() }
  })
}

/** Deliver only an invitation, never the reminder title or medical details. */
async function sendAssignmentInvitation(creatorId: string, email: string, creatorName: string): Promise<void> {
  if (!isEmailConfigured()) throw new HttpError(503, 'Email invitations are unavailable right now.')
  if (!rateLimit(`assignment-invite:${creatorId}:${email}`, 5, 24 * 60 * 60_000)) {
    throw tooManyRequests('Too many invitations sent. Try again later.')
  }
  const appUrl = clientOrigins[0]?.replace(/\/$/, '') ?? 'https://persistent.dynamic-solutions.ca'
  await sendCloudflareEmail({
    to: email,
    ...buildAssignmentInvitationEmail({ ownerName: creatorName, email, appUrl })
  })
}

/** Creator progress includes exact completion times but no assignee account data. */
assignmentsRouter.get('/sent', async (request, response) => {
  const creatorId = requireUserId(request)
  const rows = await prisma.reminderAssignment.findMany({
    where: { creatorId },
    orderBy: { createdAt: 'desc' },
    include: { reminder: { include: { occurrences: { orderBy: { scheduledFor: 'desc' }, take: 20 } } } }
  })
  const assignments: Assignment[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    recipientEmail: row.recipientEmail,
    state: row.state,
    reminderId: row.reminderId,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    lastCompletedAt: row.lastCompletedAt?.toISOString() ?? null,
    recentFirings: (row.reminder?.occurrences ?? []).map((firing) => ({
      id: firing.id,
      scheduledFor: firing.scheduledFor.toISOString(),
      status: firing.status,
      acknowledgedAt: firing.acknowledgedAt?.toISOString() ?? null
    }))
  }))
  response.json({ assignments })
})

assignmentsRouter.get('/received', async (request, response) => {
  const recipientId = requireUserId(request)
  const rows = await prisma.reminderAssignment.findMany({
    where: { recipientId, state: 'ACTIVE', reminder: { is: { userId: recipientId } } },
    include: { creator: { select: { email: true, displayName: true } } }
  })
  response.json({ assignments: rows.map((row) => ({
    reminderId: row.reminderId,
    creatorName: row.creator.displayName || row.creator.email
  })) })
})

assignmentsRouter.post('/', async (request, response) => {
  const creatorId = requireUserId(request)
  const parsed = assignmentCreateSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid assignment.')
  if (!rateLimit(`assignment-create:${creatorId}`, 30, 24 * 60 * 60_000) ||
      !rateLimit(`assignment-create:${creatorId}:${parsed.data.recipientEmail}`, 5, 24 * 60 * 60_000)) {
    throw tooManyRequests('Too many assignments created. Try again later.')
  }

  const creator = await prisma.user.findUniqueOrThrow({
    where: { id: creatorId },
    select: { email: true, displayName: true }
  })
  if (parsed.data.recipientEmail === creator.email.toLowerCase()) {
    throw badRequest('Choose someone other than yourself.')
  }
  const recipient = await prisma.user.findFirst({
    where: { email: { equals: parsed.data.recipientEmail, mode: 'insensitive' } },
    select: { id: true }
  })
  if (recipient?.id === creatorId) throw badRequest('Choose someone other than yourself.')

  const result = await prisma.$transaction(async (transaction) => {
    const reminder = recipient ? await transaction.reminder.create({
      data: { ...toReminderData(parsed.data.reminder), userId: recipient.id }
    }) : null
    const assignment = await transaction.reminderAssignment.create({
      data: {
        creatorId,
        recipientId: recipient?.id ?? null,
        recipientEmail: parsed.data.recipientEmail,
        reminderId: reminder?.id ?? null,
        title: parsed.data.reminder.title,
        state: recipient ? 'ACTIVE' : 'PENDING',
        acceptedAt: recipient ? new Date() : null,
        draft: recipient ? Prisma.DbNull : parsed.data.reminder as Prisma.InputJsonValue
      }
    })
    return { assignment, reminder }
  })

  await rememberRecipient(creatorId, parsed.data.recipientEmail)
  if (result.reminder) {
    await activateAssignment(result.reminder.id, result.reminder.userId)
  }
  let invitationFailed = false
  if (!recipient) {
    try {
      await sendAssignmentInvitation(
        creatorId,
        parsed.data.recipientEmail,
        creator.displayName || creator.email
      )
    } catch (error) {
      invitationFailed = true
      logger.warn('assignment invitation failed', { error: String(error), assignmentId: result.assignment.id })
    }
  }
  broadcast(creatorId, { type: 'assignment.changed' })
  response.status(201).json({ assignmentId: result.assignment.id, invitationFailed })
})

assignmentsRouter.post('/sent/:id/resend', async (request, response) => {
  const creatorId = requireUserId(request)
  const assignment = await prisma.reminderAssignment.findFirst({
    where: { id: request.params.id, creatorId, state: 'PENDING' },
    include: { creator: { select: { email: true, displayName: true } } }
  })
  if (!assignment) throw notFound('Pending assignment not found.')
  await sendAssignmentInvitation(
    creatorId,
    assignment.recipientEmail,
    assignment.creator.displayName || assignment.creator.email
  )
  response.json({ ok: true })
})
