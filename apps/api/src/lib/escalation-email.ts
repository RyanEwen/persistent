/**
 * Escalation email to a designated contact when a reminder is ignored past its
 * threshold. Uses the shared Cloudflare transport; no-op if email is unconfigured.
 */
import { DateTime } from 'luxon'
import type { Reminder } from '@prisma/client'
import { sendCloudflareEmail, isEmailConfigured } from './cloudflare-email.js'
import { notificationTitle, notificationBody } from './notification-format.js'
import { logger } from './logger.js'

export async function sendEscalationEmail(reminder: Reminder, scheduledFor: Date): Promise<void> {
  if (!reminder.escalateContactEmail) return
  if (!isEmailConfigured()) {
    logger.warn('escalation email skipped: email not configured', { reminderId: reminder.id })
    return
  }

  const when = DateTime.fromJSDate(scheduledFor).toUTC().toFormat("yyyy-LL-dd HH:mm 'UTC'")
  const title = notificationTitle(reminder)
  const body = notificationBody(reminder)
  const subject = `Missed reminder: ${title}`
  const text = [
    `A Persistent reminder has gone unacknowledged and was escalated to you as the contact.`,
    '',
    `Reminder: ${title}`,
    ...(body ? [`Details: ${body}`] : []),
    `Scheduled for: ${when}`,
    '',
    'You are receiving this because you were set as the escalation contact for this reminder.'
  ].join('\n')

  await sendCloudflareEmail({ to: reminder.escalateContactEmail, subject, text })
  logger.info('sent escalation email', { reminderId: reminder.id })
}
