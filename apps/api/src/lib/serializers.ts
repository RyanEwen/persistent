/**
 * Prisma-row -> shared-DTO serializers. Keeps the JSON shape the web client
 * sees consistent and matching the Zod schemas in @persistent/shared.
 */
import type { Reminder as ReminderRow, ReminderOccurrence, User, Passkey } from '@prisma/client'
import type { Occurrence, Reminder, SessionUser, Schedule, TypeData, PasskeyInfo } from '@persistent/shared'

export function toPasskey(row: Passkey): PasskeyInfo {
  return {
    id: row.id,
    name: row.name,
    aaguid: row.aaguid,
    transports: row.transports ? row.transports.split(',').filter(Boolean) : [],
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null
  }
}

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
    type: row.type,
    typeData: (row.typeData ?? {}) as TypeData,
    schedule: row.schedule as unknown as Schedule,
    persistence: row.persistence,
    soundIntervalSeconds: row.soundIntervalSeconds,
    shadeProminence: row.shadeProminence,
    escalateAfterMinutes: row.escalateAfterMinutes,
    escalateAtTime: row.escalateAtTime,
    escalateEmail: row.escalateEmail,
    escalateEmailMessage: row.escalateEmailMessage,
    escalateEmailAfterMinutes: row.escalateEmailAfterMinutes,
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

/**
 * `checkedItems` is a loose JSON column, so narrow it to the string array the DTO
 * promises rather than trusting the shape. Anything else reads as "nothing ticked".
 */
export function toCheckedItemIds(value: ReminderOccurrence['checkedItems']): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export function toOccurrence(row: ReminderOccurrence & { reminder: ReminderRow }): Occurrence {
  return {
    id: row.id,
    reminderId: row.reminderId,
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status,
    firedAt: row.firedAt?.toISOString() ?? null,
    lastNotifiedAt: row.lastNotifiedAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    escalatedAt: row.escalatedAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    checkedItemIds: toCheckedItemIds(row.checkedItems),
    reminder: {
      title: row.reminder.title,
      details: row.reminder.details,
      type: row.reminder.type,
      typeData: (row.reminder.typeData ?? {}) as TypeData,
      persistence: row.reminder.persistence,
      soundIntervalSeconds: row.reminder.soundIntervalSeconds,
      shadeProminence: row.reminder.shadeProminence
    }
  }
}
