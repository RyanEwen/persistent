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

The three user actions on a firing are **Done**, **Silence**, and **Snooze**.
Their guaranteed effects follow.

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
reminder — only Done does that.

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
- This holds on every surface: the in-app list shows one attention card per
  pending occurrence; the web SW tags notifications per occurrence; the native
  client keys notifications and alarms per occurrence.

This is a deliberate reversal of the old "one notification per reminder"
self-collapse (`keepNewestForReminder` / the `SUPERSEDED` status), which would
let confirming a later dose silently erase an un-taken earlier one — wrong for a
medication-grade persistence app. `SUPERSEDED` is retained only as a legacy
status on historical rows and is never assigned anymore.

> Consequence to keep in mind: a reminder a user ignores across several scheduled
> times will accumulate one pending occurrence per missed time (each must be
> cleared). That is intended — the app's job is to not let any single firing be
> forgotten. The smallest repeat granularity is per-time-of-day (there is no
> sub-hour auto-repeat), so this does not produce runaway stacks; within a single
> firing, re-nagging is the re-sound interval, not new occurrences.
