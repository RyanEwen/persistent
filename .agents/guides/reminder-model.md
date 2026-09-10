# Reminder model

This guide condenses the reminder invariants that span the API, web, mobile, and
shared package. The detailed user-facing guarantee lives in
`docs/notification-behavior.md`; delivery mechanics live in
`docs/alarm-architecture.md`; canonical schemas live in
`packages/shared/src/reminders.ts`.

## Types and checklist ownership

A reminder's `type` (`NONE`, `TODO`, or `MEDICATION`) selects the extra fields in
`typeData`. `MEDICATION` remains valid for stored reminders but is temporarily
withheld from the picker through `selectableReminderTypes`. Do not point the
picker back at `reminderTypes` or add health framing to the Play listing while
that restriction stands.

A `TODO` owns its checklist item definitions, while an occurrence owns which
items are checked. Each repeating firing therefore starts blank. Notification
content includes only unticked items. Checking every item does not acknowledge
the occurrence; only Done does.

Card item additions, reordering, and renames update the reminder definition and
future firings. Additions arrive unticked; ranking-based reorder must not drop a
concurrent item; renames retain item identity. These writes also update live
notification content.

A note is the exception because it has no occurrences. Its checked item IDs live
on `Reminder.checkedItems`, and the server clears them when it gains a schedule.
`Reminder.hideCheckedItems` is presentation state, stored on the reminder so it
follows the user across devices; it never changes notification content or the
persistence guarantee.

## Occurrences and schedules

Each `ReminderOccurrence` is independent. A later firing never suppresses an
older unacknowledged one, and acknowledging one occurrence never clears another.
`SUPERSEDED` is legacy-only and must not be produced.

The editor's When choice maps to three real schedule states:

- `none`: Remind me now. Create exactly one immediate firing when the user asks
  for this state. `materializeReminder` must never expand it, or the scheduler
  would recreate a completed reminder every five minutes.
- A dated schedule: materialize occurrences through the scheduler.
- `never`: a note. It has no occurrences, cannot nag or escalate, and belongs on
  the Notes surface rather than Current or Upcoming.

`none` and `never` are the two timeless kinds recognized by `isTimeless`.
`startDate` on `none` only records when that state was saved; it is not a window.

`scheduleTransition` owns the special transitions:

- Gaining a real schedule retires the immediate firing created by `none`.
- Becoming a note retires every live firing.
- Losing a real schedule creates an immediate firing unless one is already live.

Edits between real schedules and edits that remain `none` never clear an
unconfirmed firing. See `docs/notification-behavior.md` for the Done, silence,
snooze, reschedule, and orphaned-occurrence contract.
