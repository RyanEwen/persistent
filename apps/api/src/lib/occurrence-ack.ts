/**
 * Ack transition rule for reminder occurrences.
 *
 * Acknowledgement = the user confirming a *nagging* occurrence is done, so it
 * only applies once the occurrence has fired (FIRED / SNOOZED / ESCALATED).
 * Re-acking an already-ACKNOWLEDGED occurrence is an idempotent no-op so client
 * retries (offline-queue drains, native pending-ack drains, double taps) stay
 * safe.
 *
 * PENDING is the subtle case. The native on-device alarm fires at `scheduledFor`,
 * which can be up to one tick (~30s) before the server tick flips the row
 * PENDING -> FIRED; a user who confirms that alarm legitimately acks a still-
 * PENDING occurrence. So a PENDING ack is allowed once the occurrence is *due*
 * (scheduledFor <= now) and rejected only while it is still in the future -- the
 * premature ack that would otherwise mark ACKNOWLEDGED before the fire time and
 * silently cancel the firing on every channel (the tick only fires PENDING, and
 * /api/sync/occurrences stops shipping it so the on-device alarm is cancelled on
 * the next sync). That premature ack is the "reminder didn't go off" failure mode.
 *
 * SUPERSEDED / MISSED are terminal; acking them is meaningless.
 */
import type { OccurrenceStatus } from '@persistent/shared'

export type AckDecision = 'apply' | 'noop' | 'reject'

export function ackDecision(status: OccurrenceStatus, scheduledFor: Date, now: Date): AckDecision {
  if (status === 'FIRED' || status === 'SNOOZED' || status === 'ESCALATED') return 'apply'
  if (status === 'ACKNOWLEDGED') return 'noop'
  if (status === 'PENDING') return scheduledFor.getTime() <= now.getTime() ? 'apply' : 'reject'
  return 'reject'
}
