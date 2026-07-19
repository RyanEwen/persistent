# Notification & alarm behavior contract

This is the source-of-truth specification for how a reminder behaves once it
fires — across the in-app UI, the web/PWA notification, and the native Android
notification/alarm. It is intentionally device-agnostic: every surface (in-app,
service worker, native plugin) must converge on the same outcome.

Background model lives in [`alarm-architecture.md`](alarm-architecture.md)
(device-scheduled + server backup) and the state machine in
[`data-event-contract.md`](data-event-contract.md). This doc is the *user-facing
guarantee* those mechanisms exist to deliver.

## Vocabulary

- **Occurrence** — one firing of a reminder (`ReminderOccurrence`). A reminder
  with three times of day, or a repeating schedule, produces many occurrences.
- **Notification** — the soft nag: a notification that re-appears until confirmed
  (and, on `PERSISTENT` reminders, optionally re-sounds on an interval).
- **Alarm** — the hard nag: looping sound + vibration, full-screen on Android,
  not dismissable. A reminder is an alarm either because its persistence is
  `ALARM`, or because a `PERSISTENT` reminder **escalated** (after N minutes, or
  at a wall-clock time) from notification to alarm.
- **Confirm / Done / acknowledge** — the user explicitly marks the occurrence
  complete. This is the *only* thing that ends a nag for good.

Two things hold on every surface regardless of which action the user takes:

- **Tapping the notification body opens the reminder.** A soft nag's body tap
  brings the app forward on that reminder's detail view (an *alarm's* body tap is
  the exception — it opens the full-screen control surface, so Done/Snooze stay one
  tap away once the heads-up collapses). On Android this must be a direct activity
  start; see the trampoline note in [`alarm-architecture.md`](alarm-architecture.md).
- **A multi-line description renders on multiple lines.** Details are authored in a
  multi-line textarea, so those line breaks are content: the web detail view and
  attention cards use `pre-wrap`, the native notification uses `BigTextStyle`, the
  full-screen alarm renders them as-is, and the escalation email is plain text. The
  compact list row is the one deliberate exception — it is single-line by design, so
  breaks collapse to spaces there.

The three user actions on a firing are **Done**, **Silence**, and **Snooze**.
Their guaranteed effects follow. (Silence is labeled **"De-escalate"** in the UI —
it only ever appears on an escalated alarm, and that's what it does; the internal
action/API name remains `silence`.)

## 1. Done — clears the reminder everywhere

Marking an occurrence done — from the alarm surface, the notification action, or
the in-app card, on any device — acknowledges that occurrence and **removes it
from every surface**: the alarm stops, the notification is cleared, and any
sibling escalation alarm is cancelled, on every one of the user's devices.

- Server: the occurrence becomes `ACKNOWLEDGED` (terminal) and the server
  broadcasts a `dismiss` over WebSocket **and** push (Web Push + FCM).
- Native: clears the notification and cancels both the main and `::esc`
  (escalation) on-device alarms; closes the full-screen alarm activity.
- Web/SW: closes the notification by its occurrence-id tag.

**Done is always a two-tap confirm** on every *tap* surface — the notification, the
full-screen alarm, and the in-app card (on the reminders list or a reminder's
detail view). The first tap arms the action (swapping
the controls to *Confirm done* / *Not yet*, with the alarm still ringing); only
the confirm tap acknowledges. This guards a persistence-grade reminder against a
stray pocket tap or misclick clearing it by accident. *Not yet* restores the
normal controls and changes nothing. (The Android Auto **voice** surface is the
one exception — see §5: a spoken "done" is inherently deliberate, so it
acknowledges directly.)

Done is the terminal action — it is the persistence guarantee being satisfied.

## 2. Silence — drops the alarm back to the notification it escalated from

Silence applies only to an **escalated** alarm (a `PERSISTENT` reminder that
escalated; an inherent `ALARM` reminder has no Silence — it is meant to ring
until done). Silencing **stops the alarm but keeps the reminder nagging** as the
ordinary notification that preceded the escalation:

- The looping sound/vibration and full-screen surface stop.
- The reminder stays **`FIRED`** (unconfirmed) and continues to nag exactly as a
  pre-escalation notification would — including the `PERSISTENT` re-sound
  interval if one is set.
- It will **never escalate to an alarm again** for this firing
  (`escalationSilencedAt` suppresses both the server sweep and the on-device
  escalation alarm).
- Silence propagates to every device (WS + push `silence`): the native client
  downgrades the alarm in place; the web SW re-shows it as a plain nag.

Silence is "stop yelling, but keep reminding me." It does **not** acknowledge the
reminder — only Done does that. And the reverse holds: silencing (or snoozing) an
already-acknowledged occurrence is a **no-op** — a queued device action draining
after an ack must never resurrect a terminal occurrence back to nagging.

## 3. Snooze — snoozes the firing (the alarm), not just a notification

Snoozing temporarily clears the firing — alarm and notification both — and
re-fires it after the chosen delay. When the firing is currently an **alarm**,
snooze snoozes *that*: the alarm goes away now and **rings again** when the snooze
elapses (it does not silently degrade into a soft notification).

- Server: the occurrence becomes `SNOOZED` with `snoozedUntil`; a `dismiss`
  clears it from all devices now. When `snoozedUntil` passes, the sweep revives
  it to `FIRED` and it nags again; if its escalation threshold has already
  passed, it escalates (rings) again immediately — i.e. you snoozed the alarm.
- Native: cancels the current notification/alarm and re-arms the on-device alarm
  to fire `now + minutes`, so it still works offline.
- The escalation backstop stays anchored to the original fire, never reset by a
  snooze (escalation is a hard backstop, not a thing you can indefinitely defer
  by snoozing).

## 4. Multiple times / repeats are independent

A reminder with several times of day, or a repeating schedule, is treated as
**independent occurrences**. The system never replaces an earlier still-pending
firing with a later one:

- If the 9:00 dose is still unconfirmed when the 13:00 dose fires, **both** nag —
  two notifications (or alarms), each with its own Done / Silence / Snooze.
- Each must be confirmed **separately**. Confirming 13:00 does **not** clear 9:00;
  acking, snoozing, or silencing one occurrence affects only that occurrence.
- This holds on every surface: the in-app list (and a reminder's detail view)
  shows one attention card per pending occurrence; the web SW tags notifications
  per occurrence; the native client keys notifications and alarms per occurrence.

This is a deliberate reversal of the old "one notification per reminder"
self-collapse (`keepNewestForReminder` / the `SUPERSEDED` status), which would
let confirming a later dose silently erase an un-taken earlier one — wrong for a
medication-grade persistence app. `SUPERSEDED` is retained only as a legacy
status on historical rows and is never assigned anymore.

## 5. Android Auto — the same actions, by voice, in the car

While the phone is projecting to Android Auto, the native notification is mirrored
into the car (as a `MessagingStyle` notification — the only form Auto surfaces).
This is a **projection of the native surface, not a new outcome**: the same three
actions apply and converge to the same server state as everywhere else. Because Auto
offers no arbitrary buttons, the user acts by **voice reply**:

- "done" / "finished" / "all done" → **Done** (acknowledges). This is the one place
  Done is *not* a two-tap confirm — a spoken Done is inherently deliberate and there
  is no pocket-tap to guard against.
- "snooze 15 minutes" / "in an hour" → **Snooze** for the parsed duration (default
  10 minutes if none is spoken).
- "de-escalate" / "silence" → **Silence**, but only when the occurrence is actually
  ringing as an escalated alarm (otherwise ignored).
- An unrecognized reply is ignored — the nag persists.

Auto's **mark-as-read** action (and reading the reminder aloud) **never**
acknowledges — only an explicit spoken Done does; the persistence guarantee holds in
the car exactly as on every other surface. A continuously-looping alarm tone is not
an Auto capability, so in-car an alarm is an urgent messaging heads-up (Auto's chime
+ read-aloud) while the real looping alarm keeps ringing on the phone. See
[`alarm-architecture.md`](alarm-architecture.md) (Android Auto) for the mechanism.

> Consequence to keep in mind: a reminder a user ignores across several scheduled
> times will accumulate one pending occurrence per missed time (each must be
> cleared). That is intended — the app's job is to not let any single firing be
> forgotten. The smallest repeat granularity is per-time-of-day (there is no
> sub-hour auto-repeat), so this does not produce runaway stacks; within a single
> firing, re-nagging is the re-sound interval, not new occurrences.

## 6. Editing a reminder never silently clears an unconfirmed firing

Rescheduling is not a way to make a nag go away. Editing a reminder drops its
not-yet-fired (`PENDING`) occurrences and re-materializes from the new schedule,
but an occurrence that has already **fired and not been confirmed survives the
edit** — §1 still holds, and only Done ends it. A reminder whose 09:00 dose is
unconfirmed keeps nagging about that dose even if you retime it to 10:00.

The visible consequence: move a reminder's start date into the future while an
earlier firing is unconfirmed, and that firing keeps nagging against a schedule
that no longer contains its date. That is intended, but "Due" describes it badly —
the reminder now claims to start next week, yet something is due today. So the UI
tells the two apart (`isOutsideReminderWindow`, `apps/web/src/lib/occurrenceSchedule.ts`):
a firing whose date falls outside the reminder's current start/end window is
labelled **Unconfirmed** rather than Due, carries a line explaining it fired before
the reschedule, and offers **Clear** in place of Done. It still takes the same
two-tap confirm and the same acknowledge — only the wording changes, because
calling it "Done" would claim the user completed something the reminder has moved
on from.

The comparison is deliberately by **date, not time of day**: retiming a reminder
whose dose is still unconfirmed must keep that dose nagging, because the day it
belongs to is still covered.

**The one exception** is a reminder that had no schedule at all (kind `none` — see
the root `CLAUDE.md`). Its single firing is an artifact of being unscheduled, not a
commitment to a date, so giving it a real schedule retires that firing instead of
leaving it behind.
