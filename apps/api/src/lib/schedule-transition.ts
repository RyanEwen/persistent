/**
 * What an edit does to a reminder's firings when it crosses the boundary between
 * having a schedule and having none.
 *
 * The two sides are not symmetric, and both are exceptions worth naming:
 *
 * - `retire` — the reminder gained a real schedule, so its immediate "remind me
 *   about this" firing was an artifact of having none, not a commitment to a
 *   date. Dropping it is the single case where an edit clears an unconfirmed
 *   firing (docs/notification-behavior.md §6).
 * - `mint` — the reminder lost its schedule, so it becomes "remind me about
 *   this" and wants that one firing. Whatever its old schedule left unconfirmed
 *   still stands (§1), so this is only a request: `ensureUnscheduledFiring`
 *   declines when something is already nagging, since a second firing would show
 *   the same reminder twice with no time on either card to tell them apart.
 * - `null` — the edit stays on one side of the boundary. Firings carry over
 *   untouched, including an edit from unscheduled to unscheduled: the user
 *   changed the wording, they didn't ask to be reminded again.
 */
export type ScheduleTransition = 'retire' | 'mint' | null

/** Compare the stored schedule kind with the incoming one. */
export function scheduleTransition(before: string, after: string): ScheduleTransition {
  const wasUnscheduled = before === 'none'
  const isUnscheduled = after === 'none'
  if (wasUnscheduled === isUnscheduled) return null
  return wasUnscheduled ? 'retire' : 'mint'
}
