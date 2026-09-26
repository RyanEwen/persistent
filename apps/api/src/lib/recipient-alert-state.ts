/** Project the owner's canonical firing into one recipient's alert state. */
import type { OccurrenceStatus, RecipientAlertState, ReminderOccurrence } from '@prisma/client'
import { prisma } from './prisma.js'

const TERMINAL_OR_FUTURE: OccurrenceStatus[] = ['PENDING', 'ACKNOWLEDGED', 'MISSED', 'SUPERSEDED']

/**
 * The reminder's Done and checklist state stay on its one occurrence. A recipient
 * sees their own snooze, escalation, and de-escalation without changing anyone
 * else's alert. The caller must first prove this recipient has a share grant.
 */
export function occurrenceForActor<T extends ReminderOccurrence>(
  occurrence: T,
  actorId: string,
  state: RecipientAlertState | null | undefined
): T {
  if (occurrence.userId === actorId) return occurrence

  let status: OccurrenceStatus = 'FIRED'
  if (TERMINAL_OR_FUTURE.includes(occurrence.status)) {
    status = occurrence.status
  } else if (state?.snoozedUntil) {
    status = 'SNOOZED'
  } else if (state?.escalatedAt && !state.escalationSilencedAt) {
    status = 'ESCALATED'
  }

  return {
    ...occurrence,
    status,
    snoozedUntil: state?.snoozedUntil ?? null,
    escalatedAt: state?.escalatedAt ?? null,
    escalationSilencedAt: state?.escalationSilencedAt ?? null,
    lastNotifiedAt: state?.lastNotifiedAt ?? occurrence.firedAt
  }
}

/**
 * Claim a recipient's first escalation using the current firing and personal
 * snooze, rather than the scheduler's earlier snapshot. The grant and live
 * occurrence checks also prevent a stale sweep from creating an alert after
 * completion or removal from the reminder.
 */
export async function claimRecipientEscalation(
  occurrenceId: string,
  recipientId: string,
  now: Date
): Promise<RecipientAlertState | null> {
  const claimed = await prisma.$queryRaw<RecipientAlertState[]>`
    INSERT INTO "RecipientAlertState" ("occurrenceId", "recipientId", "escalatedAt", "lastNotifiedAt")
    SELECT occurrence."id", share."recipientId", ${now}, ${now}
    FROM "ReminderOccurrence" AS occurrence
    JOIN "ReminderShare" AS share ON share."reminderId" = occurrence."reminderId"
    WHERE occurrence."id" = ${occurrenceId}
      AND share."recipientId" = ${recipientId}
      AND occurrence."status" IN ('FIRED', 'SNOOZED', 'ESCALATED')
    ON CONFLICT ("occurrenceId", "recipientId") DO UPDATE
      SET "escalatedAt" = ${now}, "lastNotifiedAt" = ${now}, "snoozedUntil" = NULL
    WHERE "RecipientAlertState"."escalatedAt" IS NULL
      AND "RecipientAlertState"."escalationSilencedAt" IS NULL
      AND ("RecipientAlertState"."snoozedUntil" IS NULL OR "RecipientAlertState"."snoozedUntil" <= ${now})
      AND EXISTS (
        SELECT 1
        FROM "ReminderOccurrence" AS current_occurrence
        JOIN "ReminderShare" AS current_share
          ON current_share."reminderId" = current_occurrence."reminderId"
        WHERE current_occurrence."id" = ${occurrenceId}
          AND current_share."recipientId" = ${recipientId}
          AND current_occurrence."status" IN ('FIRED', 'SNOOZED', 'ESCALATED')
      )
    RETURNING *
  `
  return claimed[0] ?? null
}

/** Revive a personal snooze only if it is still elapsed and the grant is live. */
export async function claimRecipientSnoozeRevival(
  occurrenceId: string,
  recipientId: string,
  now: Date
): Promise<RecipientAlertState | null> {
  const claimed = await prisma.$queryRaw<RecipientAlertState[]>`
    UPDATE "RecipientAlertState" AS state
    SET "snoozedUntil" = NULL, "lastNotifiedAt" = ${now}
    FROM "ReminderOccurrence" AS occurrence, "ReminderShare" AS share
    WHERE state."occurrenceId" = ${occurrenceId}
      AND state."recipientId" = ${recipientId}
      AND state."snoozedUntil" <= ${now}
      AND occurrence."id" = state."occurrenceId"
      AND occurrence."status" IN ('FIRED', 'SNOOZED', 'ESCALATED')
      AND share."reminderId" = occurrence."reminderId"
      AND share."recipientId" = state."recipientId"
    RETURNING state.*
  `
  return claimed[0] ?? null
}
