/**
 * Explicit reminder sharing. A share never changes ownership of the reminder or
 * its firings. Owner queries and recipient queries use separate user-scoped keys.
 */
import { Router } from 'express'
import { isTimeless, shareInputSchema, type Schedule, type SharedReminder } from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, notFound } from '../lib/http-error.js'
import { broadcast } from '../lib/realtime.js'
import { sendShareInvitation } from '../lib/share-invitations.js'
import { occurrenceForActor } from '../lib/recipient-alert-state.js'
import { nudgeNativeSync } from '../lib/delivery/index.js'
import { logger } from '../lib/logger.js'
import { toCheckedItemIds, toReminder } from '../lib/serializers.js'
import { expandSchedule } from '../lib/schedule-expand.js'
import type { Prisma } from '@prisma/client'

export const sharesRouter = Router()
sharesRouter.use(requireUser)

const receivedShareInclude = {
  reminder: { include: { user: { select: { email: true, displayName: true, timeZone: true } } } }
} satisfies Prisma.ReminderShareInclude

/** Remember an address after a grant or invitation is stored, even if later removed. */
async function rememberRecipient(ownerId: string, email: string): Promise<void> {
  await prisma.shareRecipient.upsert({
    where: { ownerId_email: { ownerId, email } },
    create: { ownerId, email },
    update: { lastSharedAt: new Date() }
  })
}

/** Send only fields that the recipient needs to read the reminder. */
function toSharedReminder(
  share: Prisma.ReminderShareGetPayload<{ include: typeof receivedShareInclude }>,
  firings: SharedReminder['activeFirings'],
  now: Date
): SharedReminder {
  const { reminder } = share
  const schedule = reminder.schedule as unknown as Schedule
  const nextScheduledFor = reminder.active && !isTimeless(schedule.kind)
    ? expandSchedule({
        schedule,
        startDate: reminder.startDate,
        endDate: reminder.endDate,
        timeZone: reminder.user.timeZone,
        from: now,
        to: new Date(now.getTime() + 366 * 24 * 60 * 60_000),
        maxResults: 1
      })[0]?.toISOString() ?? null
    : null
  return {
    id: reminder.id,
    title: reminder.title,
    details: reminder.details,
    type: reminder.type,
    typeData: reminder.typeData as SharedReminder['typeData'],
    checkedItemIds: toCheckedItemIds(reminder.checkedItems),
    isNote: (reminder.schedule as { kind?: string }).kind === 'never',
    active: reminder.active,
    ownerName: reminder.user.displayName || reminder.user.email,
    ownerTimeZone: reminder.user.timeZone,
    nextScheduledFor,
    permission: 'EDIT',
    activeFirings: firings,
    editableReminder: toReminder(reminder),
    updatedAt: reminder.updatedAt.toISOString()
  }
}

sharesRouter.get('/received', async (request, response) => {
  const recipientId = requireUserId(request)
  const now = new Date()
  const shares = await prisma.reminderShare.findMany({
    where: { recipientId },
    include: receivedShareInclude,
    orderBy: { createdAt: 'desc' }
  })
  const firings = await prisma.reminderOccurrence.findMany({
    where: {
      reminderId: { in: shares.map((share) => share.reminderId) },
      reminder: { shares: { some: { recipientId } } },
      status: { in: ['FIRED', 'ESCALATED', 'SNOOZED'] }
    },
    include: { recipientAlerts: { where: { recipientId } } }
  })
  response.json({
    reminders: shares.map((share) => toSharedReminder(
      share,
      firings.filter((firing) => firing.reminderId === share.reminderId).map((firing) => {
        const personal = occurrenceForActor(firing, recipientId, firing.recipientAlerts[0])
        return {
          id: personal.id,
          status: personal.status,
          scheduledFor: personal.scheduledFor.toISOString(),
          snoozedUntil: personal.snoozedUntil?.toISOString() ?? null,
          checkedItemIds: toCheckedItemIds(personal.checkedItems)
        }
      }),
      now
    ))
  })
})

sharesRouter.get('/recipients', async (request, response) => {
  const ownerId = requireUserId(request)
  const recipients = await prisma.shareRecipient.findMany({
    where: { ownerId },
    orderBy: { lastSharedAt: 'desc' },
    take: 20,
    select: { email: true }
  })
  response.json({ recipients: recipients.map((recipient) => recipient.email) })
})

/** Leaving removes only the caller's grant; the owner's reminder and firings survive. */
sharesRouter.delete('/received/:reminderId', async (request, response) => {
  const recipientId = requireUserId(request)
  const share = await prisma.reminderShare.findFirst({
    where: { reminderId: request.params.reminderId, recipientId },
    select: { reminder: { select: { userId: true } } }
  })
  if (!share) throw notFound('Shared reminder not found.')

  await prisma.reminderShare.deleteMany({ where: { reminderId: request.params.reminderId, recipientId } })
  await prisma.recipientAlertState.deleteMany({
    where: { recipientId, occurrence: { reminderId: request.params.reminderId } }
  })
  broadcast(recipientId, { type: 'share.changed' })
  broadcast(recipientId, { type: 'reminder.changed', reminderId: request.params.reminderId })
  broadcast(share.reminder.userId, { type: 'share.changed' })
  void nudgeNativeSync(recipientId).catch((error) =>
    logger.warn('leave shared reminder sync failed', { error: String(error), reminderId: request.params.reminderId })
  )
  response.json({ ok: true })
})

sharesRouter.get('/:reminderId', async (request, response) => {
  const userId = requireUserId(request)
  const reminder = await prisma.reminder.findFirst({ where: { id: request.params.reminderId, userId } })
  if (!reminder) throw notFound('Reminder not found.')

  const shares = await prisma.reminderShare.findMany({
    where: { reminderId: reminder.id, reminder: { userId } },
    include: { recipient: { select: { email: true, displayName: true } } },
    orderBy: { createdAt: 'asc' }
  })
  const invitations = await prisma.reminderInvitation.findMany({
    where: { reminderId: reminder.id, reminder: { userId } },
    orderBy: { createdAt: 'asc' }
  })
  response.json({
    shares: [...shares.map((share) => ({
      recipientId: share.recipientId,
      email: share.recipient.email,
      displayName: share.recipient.displayName,
      permission: 'EDIT',
      pending: false
    })), ...invitations.map((invitation) => ({
      recipientId: null,
      email: invitation.email,
      displayName: null,
      permission: 'EDIT',
      pending: true
    }))]
  })
})

sharesRouter.put('/:reminderId', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = shareInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Enter a valid email and access level.')

  const reminder = await prisma.reminder.findFirst({
    where: { id: request.params.reminderId, userId },
    include: { user: { select: { email: true, displayName: true } } }
  })
  if (!reminder) throw notFound('Reminder not found.')
  if (await prisma.reminderAssignment.findUnique({ where: { reminderId: reminder.id } })) {
    throw badRequest('Assigned reminders can have only one recipient.')
  }

  // Google may have stored the account's original email casing; addresses are
  // matched case-insensitively just like the sign-in field presented to people.
  const recipient = await prisma.user.findFirst({
    where: { email: { equals: parsed.data.email, mode: 'insensitive' } }
  })
  if (recipient?.id === userId || parsed.data.email === reminder.user.email.toLowerCase()) {
    throw badRequest('You already own this reminder.')
  }

  if (!recipient) {
    const existing = await prisma.reminderInvitation.findUnique({
      where: { reminderId_email: { reminderId: reminder.id, email: parsed.data.email } }
    })
    if (!existing) {
      const count = await prisma.reminderShare.count({ where: { reminderId: reminder.id } }) +
        await prisma.reminderInvitation.count({ where: { reminderId: reminder.id } })
      if (count >= 20) throw badRequest('You can share with up to 20 people.')
    }
    await prisma.reminderInvitation.upsert({
      where: { reminderId_email: { reminderId: reminder.id, email: parsed.data.email } },
      create: { reminderId: reminder.id, email: parsed.data.email, permission: 'EDIT' },
      update: { permission: 'EDIT' }
    })
    await rememberRecipient(userId, parsed.data.email)
    // A prior attempt may have stored the invitation before email delivery
    // failed. Adding the same address must retry rather than report success.
    await sendShareInvitation({
      ownerId: userId,
      email: parsed.data.email,
      ownerName: reminder.user.displayName || reminder.user.email
    })
    broadcast(userId, { type: 'share.changed' })
    response.json({ share: { recipientId: null, email: parsed.data.email, displayName: null, permission: 'EDIT', pending: true } })
    return
  }

  const current = await prisma.reminderShare.findUnique({
    where: { reminderId_recipientId: { reminderId: reminder.id, recipientId: recipient.id } }
  })
  if (!current) {
    const count = await prisma.reminderShare.count({ where: { reminderId: reminder.id } }) +
      await prisma.reminderInvitation.count({ where: { reminderId: reminder.id } })
    if (count >= 20) throw badRequest('You can share with up to 20 people.')
  }

  const share = await prisma.reminderShare.upsert({
    where: { reminderId_recipientId: { reminderId: reminder.id, recipientId: recipient.id } },
    create: { reminderId: reminder.id, recipientId: recipient.id, permission: 'EDIT' },
    update: { permission: 'EDIT' }
  })
  await rememberRecipient(userId, parsed.data.email)
  await prisma.reminderInvitation.deleteMany({ where: { reminderId: reminder.id, email: parsed.data.email } })
  broadcast(recipient.id, { type: 'share.changed' })
  broadcast(recipient.id, { type: 'reminder.changed', reminderId: reminder.id })
  broadcast(userId, { type: 'share.changed' })
  void nudgeNativeSync(recipient.id).catch((error) =>
    logger.warn('new share sync failed', { error: String(error), reminderId: reminder.id })
  )
  response.json({
    share: {
      recipientId: share.recipientId,
      email: recipient.email,
      displayName: recipient.displayName,
      permission: 'EDIT',
      pending: false
    }
  })
})

sharesRouter.delete('/:reminderId/invitations/:email', async (request, response) => {
  const userId = requireUserId(request)
  const reminder = await prisma.reminder.findFirst({ where: { id: request.params.reminderId, userId } })
  if (!reminder) throw notFound('Reminder not found.')

  const deleted = await prisma.reminderInvitation.deleteMany({
    where: { reminderId: reminder.id, email: request.params.email.toLowerCase(), reminder: { userId } }
  })
  if (deleted.count === 0) throw notFound('Invitation not found.')
  broadcast(userId, { type: 'share.changed' })
  response.json({ ok: true })
})

sharesRouter.post('/:reminderId/invitations/:email/resend', async (request, response) => {
  const userId = requireUserId(request)
  const invitation = await prisma.reminderInvitation.findFirst({
    where: {
      reminderId: request.params.reminderId,
      email: request.params.email.toLowerCase(),
      reminder: { userId }
    },
    include: { reminder: { include: { user: { select: { email: true, displayName: true } } } } }
  })
  if (!invitation) throw notFound('Invitation not found.')
  await sendShareInvitation({
    ownerId: userId,
    email: invitation.email,
    ownerName: invitation.reminder.user.displayName || invitation.reminder.user.email
  })
  response.json({ ok: true })
})

sharesRouter.delete('/:reminderId/:recipientId', async (request, response) => {
  const userId = requireUserId(request)
  const reminder = await prisma.reminder.findFirst({ where: { id: request.params.reminderId, userId } })
  if (!reminder) throw notFound('Reminder not found.')

  const deleted = await prisma.reminderShare.deleteMany({
    where: { reminderId: reminder.id, recipientId: request.params.recipientId, reminder: { userId } }
  })
  if (deleted.count === 0) throw notFound('Share not found.')
  await prisma.recipientAlertState.deleteMany({
    where: { recipientId: request.params.recipientId, occurrence: { reminderId: reminder.id } }
  })
  broadcast(request.params.recipientId, { type: 'share.changed' })
  broadcast(request.params.recipientId, { type: 'reminder.changed', reminderId: reminder.id })
  broadcast(userId, { type: 'share.changed' })
  void nudgeNativeSync(request.params.recipientId).catch((error) =>
    logger.warn('removed share sync failed', { error: String(error), reminderId: reminder.id })
  )
  response.json({ ok: true })
})
