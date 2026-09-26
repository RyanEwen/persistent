/** Email invitations and verified-account claiming for reminder sharing. */
import { prisma } from './prisma.js'
import { clientOrigins } from './env.js'
import { isEmailConfigured, sendCloudflareEmail } from './cloudflare-email.js'
import { HttpError, tooManyRequests } from './http-error.js'
import { broadcast } from './realtime.js'
import { rateLimit } from './rate-limit.js'
import { buildShareInvitationEmail } from './share-invitation-email.js'
import { nudgeNativeSync } from './delivery/index.js'
import { logger } from './logger.js'

/** Invite an unregistered recipient without exposing reminder details in email. */
export async function sendShareInvitation(input: {
  ownerId: string
  email: string
  ownerName: string
}): Promise<void> {
  if (!isEmailConfigured()) {
    throw new HttpError(503, 'Email invitations are unavailable right now.')
  }
  if (!rateLimit(`share-invite:${input.ownerId}:${input.email}`, 5, 24 * 60 * 60_000) ||
      !rateLimit(`share-invite-owner:${input.ownerId}`, 30, 24 * 60 * 60_000)) {
    throw tooManyRequests('Too many invitations sent. Try again later.')
  }

  const appUrl = clientOrigins[0]?.replace(/\/$/, '') ?? 'https://persistent.app'
  await sendCloudflareEmail({
    to: input.email,
    ...buildShareInvitationEmail({ ownerName: input.ownerName, email: input.email, appUrl })
  })
}

/** Convert pending grants only after sign-in verifies ownership of the address. */
export async function claimShareInvitations(user: { id: string; email: string }): Promise<void> {
  const claimed = await prisma.$transaction(async (transaction) => {
    const invitations = await transaction.reminderInvitation.findMany({
      where: { email: { equals: user.email, mode: 'insensitive' } },
      include: { reminder: { select: { userId: true } } }
    })
    const claimedReminderIds: string[] = []
    for (const invitation of invitations) {
      // Delete first so an invitation revoked during sign-in cannot be claimed
      // from a stale earlier read.
      const deleted = await transaction.reminderInvitation.deleteMany({
        where: { reminderId: invitation.reminderId, email: invitation.email }
      })
      if (deleted.count === 0) continue
      if (invitation.reminder.userId !== user.id) {
        await transaction.reminderShare.upsert({
          where: { reminderId_recipientId: { reminderId: invitation.reminderId, recipientId: user.id } },
          create: { reminderId: invitation.reminderId, recipientId: user.id, permission: 'EDIT' },
          update: { permission: 'EDIT' }
        })
        claimedReminderIds.push(invitation.reminderId)
      }
    }
    return claimedReminderIds
  })
  if (claimed.length > 0) {
    broadcast(user.id, { type: 'share.changed' })
    for (const reminderId of claimed) {
      broadcast(user.id, { type: 'reminder.changed', reminderId })
    }
    void nudgeNativeSync(user.id).catch((error) =>
      logger.warn('claimed invitation sync failed', { error: String(error), userId: user.id })
    )
  }
}
