# Alarm architecture (the persistence guarantee)

This is the most important design doc in the project. Read it before changing
anything about how reminders fire.

## The hard reality

Truly **undismissable** notifications and a **repeating alarm sound while the app
is closed** are native-OS capabilities. The web/PWA platform cannot guarantee
them:

- Web Push shows a notification, but the OS owns dismissal and sound. Mobile
  browsers largely ignore `requireInteraction`.
- A closed PWA cannot run a timer to re-alert; it can only react to a server push.
- iOS Web Push is limited and gated on installed PWAs.

So we split responsibilities:

| Surface | Role | Guarantee |
|---|---|---|
| Web / PWA | manage reminders; soft nags | **best-effort** (`requireInteraction` + re-fire on dismissal in the service worker) |
| Android native (Capacitor) | notifications + alarms | **hard**: an ongoing notification that re-sounds (Notification level) or a full-screen, continuously-ringing Alarm — until "Done" |

## Model: device-scheduled + server backup

- **Server is the source of truth.** `apps/api` materializes `ReminderOccurrence`
  rows from each reminder's schedule (timezone-correct, `lib/schedule-expand.ts`)
  and fires due ones (tick loop), broadcasting over `/ws` and via push.
- **The device schedules its own alarms.** The JS bridge (`apps/web/src/native/`,
  bundled into the web app and started after sign-in by `useAuth`) pulls upcoming
  occurrences from `GET /api/sync/occurrences` and schedules on-device exact
  alarms, so reminders fire **even offline** and even if the server is
  unreachable. It re-syncs **live on every WS event** (`reminder.changed` /
  `occurrence.*`) and on app resume; reboots re-schedule via `BOOT_COMPLETED`.
  Ack/snooze/delete elsewhere broadcast `dismiss`, which the bridge turns into a
  native cancel so a cleared/deleted reminder's alarm stops on every device.
- **Server push is the backup**, not the primary fire path for native: it covers
  cross-device delivery, ad-hoc/just-created reminders, and escalation.

## Native alarm plugin (`apps/mobile/android-plugin`, Kotlin)

A custom Capacitor plugin provides what `@capacitor/local-notifications` cannot.
The Kotlin sources live in `apps/mobile/android-plugin` and are wired into the
generated Android project by `apps/mobile/scripts/setup-android.mjs`; the JS that
drives them lives in `apps/web/src/native`.

- `AlarmManager.setExactAndAllowWhileIdle` for exact, Doze-surviving alarms.
- On fire, a **foreground service** posts an ongoing notification and, by
  persistence level:
  - **Notification (`PERSISTENT`)** — plays the chosen notification sound once;
    optionally re-posts + re-sounds every N minutes (`soundIntervalSeconds`).
  - **Alarm (`ALARM`)** — full-screen intent + **continuously looping** the chosen
    alarm sound + vibration (no interval; it's relentless).
  - Swiping a notification away **re-posts all active ones** (delete-intent) so
    they can't be casually dismissed (even when several are swiped together); only
    Done/Snooze clear them.
  - Each occurrence gets its **own notification id**, so multiple due reminders
    show at once (the foreground service rebinds to a remaining one as they clear).
  - **Snooze** opens a small duration picker (`SnoozePickerActivity`); the chosen
    minutes are re-armed locally and queued to the server (`PendingSnoozeStore`).
- **Sounds are user-chosen** (per device): `pickSound` opens the system ringtone
  picker; the chosen URIs are stored in settings and passed through as the
  alarm/notification tone (system default otherwise). The service plays audio
  itself (silent channel) so each tone is honored.
- Stops **only** on **Done**, a deliberate **two-tap confirm**: the first tap
  swaps the notification's actions to *Confirm done* / *Not yet* (the alarm keeps
  ringing) so an accidental pocket tap can't dismiss the nag; the confirm tap
  cancels the service + sound and `POST`s the ack (queued offline via
  `PendingAckStore`). **Done never opens the app** — the queued ack is delivered
  to the server the next time the WebView runs (app open / resume / WS event), so
  another device may keep nagging until then. The full-screen `AlarmActivity` is
  itself the deliberate surface, so its Done confirms in one tap.
- A `BOOT_COMPLETED` receiver re-schedules pending alarms from the local mirror.

Permissions: `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, `POST_NOTIFICATIONS`,
`FOREGROUND_SERVICE` (+ `_SPECIAL_USE`), `USE_FULL_SCREEN_INTENT`, `WAKE_LOCK`,
`RECEIVE_BOOT_COMPLETED`; prompt for battery-optimization exemption.

## Push channels

- **Web Push (VAPID)** for browsers — `apps/api/src/lib/delivery/web-push.ts`.
- **FCM (HTTP v1)** for native Android — `apps/api/src/lib/delivery/fcm-push.ts`
  (optional; no-op until `FCM_*` env is set). The dispatcher
  (`delivery/index.ts`) targets each device by `PushSubscription.kind`.

## Escalation

A reminder may **escalate to an alarm** if unacknowledged — either N minutes
after firing (`escalateAfterMinutes`) or at a specific wall-clock time
(`escalateAtTime`, user-tz aware). Escalation always rings an alarm on the user's
own devices and may **also email a contact** (`escalateEmail` +
`escalateEmailMessage`, sent once via `sendCloudflareEmail` on escalation). It
does **not** apply to `ALARM`-persistence reminders (they already ring
continuously — enforced in the shared schema). After a longer cutoff an
unacknowledged occurrence is marked `MISSED`.

The escalation instant is computed once (`escalateAtFor` in `lib/scheduler.ts`)
and used in two places so it fires regardless of connectivity:

- **Server sweep** flips the occurrence to `ESCALATED` and dispatches an alarm
  push — the cross-device / web path.
- **`/api/sync`** returns the same instant as `occurrence.escalateAt`, so the
  native client schedules the escalation as a **second on-device exact alarm**
  (keyed `<occurrenceId>::esc`, looping alarm). This is the path that actually
  fires on Android without FCM and while offline; it's cancelled together with
  the main alarm on ack/dismiss, and a Done on it acks the underlying occurrence.

## Residual risk

Aggressive OEM battery managers (Xiaomi, Samsung, etc.) can still defer alarms.
We mitigate with exact alarms + foreground service + the battery-exemption
prompt, and document the residual risk to users.
