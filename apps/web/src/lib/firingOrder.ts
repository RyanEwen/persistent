/**
 * How pending firings are ordered wherever more than one is shown at once — the
 * main list's attention cards and a reminder's detail view. Shared so the two
 * can't drift, the same way `firingTone.ts` shares how loudly they present.
 *
 * **Newest first.** The firing that just arrived is the one the user is reacting
 * to, so it belongs at the top rather than under something they have already
 * looked at and left. This is a deliberate reversal of "most overdue first": age
 * is what the nag itself is for — an old unconfirmed firing keeps nagging until
 * it is confirmed, so it does not also need to hold the top of the list.
 *
 * Escalations still come first regardless of age. An escalated firing is ringing
 * an alarm right now, which is the one case where urgency outranks recency (it is
 * also the only firing that gets a loud card — see `firingTone.ts`).
 */
import type { Occurrence } from '@persistent/shared'

/**
 * When this firing last appeared, as an epoch time.
 *
 * `firedAt` rather than `scheduledFor`, because they diverge exactly where it
 * matters: an unscheduled firing has no meaningful scheduled time, and an
 * orphaned one is dated to a schedule the reminder has since moved off. Both
 * still *appeared* when they appeared.
 */
export function firingRecency(occurrence: Occurrence): number {
  return Date.parse(occurrence.firedAt ?? occurrence.scheduledFor)
}

function escalationRank(occurrence: Occurrence): number {
  return occurrence.status === 'ESCALATED' ? 0 : 1
}

/** Sort comparator: escalations first, then most recently fired first. */
export function compareFirings(a: Occurrence, b: Occurrence): number {
  return escalationRank(a) - escalationRank(b) || firingRecency(b) - firingRecency(a)
}
