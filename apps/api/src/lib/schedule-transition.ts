/**
 * What an edit does to a reminder's existing firings when it moves between the
 * three ways a reminder can (or can't) be scheduled: a real schedule, `none`
 * ("remind me about this", one immediate firing) and `never` (a note, no firing
 * ever).
 *
 * Most edits touch nothing — only Done clears a firing
 * (docs/notification-behavior.md §1). These are the named exceptions:
 *
 * - `retire` — the firings the reminder is carrying no longer make sense, so they
 *   are dropped (and dismissed on every device). Two edits qualify:
 *     * gaining a real schedule after having none: the immediate firing was an
 *       artifact of being unscheduled, not a commitment to a date;
 *     * becoming a note: the user has said this thing does not remind. Leaving a
 *       nag behind for a reminder that now reads "never fires" contradicts the
 *       mode they just chose, and unlike an ordinary reschedule there is no later
 *       firing for the obligation to carry forward to.
 * - `mint` — the reminder lost its schedule (or stopped being a note), so it
 *   becomes "remind me about this" and wants that one firing. Whatever its old
 *   schedule left unconfirmed still stands (§1), so this is only a request:
 *   `ensureUnscheduledFiring` declines when something is already nagging, since a
 *   second firing would show the same reminder twice with no time on either card
 *   to tell them apart.
 * - `null` — the edit stays on one side of the boundary. Firings carry over
 *   untouched, including an edit from unscheduled to unscheduled: the user
 *   changed the wording, they didn't ask to be reminded again.
 */
export type ScheduleTransition = 'retire' | 'mint' | null

/** Compare the stored schedule kind with the incoming one. */
export function scheduleTransition(before: string, after: string): ScheduleTransition {
  // Nothing crossed a boundary — including note -> note, which must not run the
  // retire pass over firings a note cannot have.
  if (before === after) return null
  if (after === 'never') return 'retire'
  if (before === 'none') return 'retire'
  if (after === 'none') return 'mint'
  // Both sides are real schedules (or a note gaining one, which has nothing left
  // to retire — becoming a note already cleared it).
  return null
}
