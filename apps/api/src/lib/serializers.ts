/**
 * Prisma-row -> shared-DTO serializers. Keeps the JSON shape the web client
 * sees consistent and matching the Zod schemas in @persistent/shared.
 */
import type { Reminder as ReminderRow, ReminderOccurrence, User } from '@prisma/client'
import type { Occurrence, Reminder, SessionUser, Schedule, CategoryData } from '@persistent/shared'

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    timeZone: user.timeZone,
    createdAt: user.createdAt.toISOString()
  }
}

export function toReminder(
  row: ReminderRow,
  lastOccurrence?: Pick<ReminderOccurrence, 'status' | 'scheduledFor'> | null
): Reminder {
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    category: row.category,
    categoryData: (row.categoryData ?? {}) as CategoryData,
    schedule: row.schedule as unknown as Schedule,
    persistence: row.persistence,
    soundIntervalSeconds: row.soundIntervalSeconds,
    escalateAfterMinutes: row.escalateAfterMinutes,
    escalateContactEmail: row.escalateContactEmail,
    escalateToOwnDevices: row.escalateToOwnDevices,
    active: row.active,
    startDate: row.startDate,
    endDate: row.endDate,
    lastOccurrence: lastOccurrence
      ? { status: lastOccurrence.status, scheduledFor: lastOccurrence.scheduledFor.toISOString() }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export function toOccurrence(row: ReminderOccurrence & { reminder: ReminderRow }): Occurrence {
  return {
    id: row.id,
    reminderId: row.reminderId,
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status,
    firedAt: row.firedAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    escalatedAt: row.escalatedAt?.toISOString() ?? null,
    reminder: {
      title: row.reminder.title,
      details: row.reminder.details,
      category: row.reminder.category,
      categoryData: (row.reminder.categoryData ?? {}) as CategoryData,
      persistence: row.reminder.persistence,
      soundIntervalSeconds: row.reminder.soundIntervalSeconds
    }
  }
}
