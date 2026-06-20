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
| Android native (Capacitor) | the alarm | **hard**: ongoing/full-screen notification + looping sound until "Done" |

## Model: device-scheduled + server backup

- **Server is the source of truth.** `apps/api` materializes `ReminderOccurrence`
  rows from each reminder's schedule (timezone-correct, `lib/schedule-expand.ts`)
  and fires due ones (tick loop), broadcasting over `/ws` and via push.
- **The device schedules its own alarms.** The native client pulls upcoming
  occurrences from `GET /api/sync/occurrences` and schedules on-device exact
  alarms, so reminders fire **even offline** and even if the server is
  unreachable. Re-sync on launch, on a `reminder.changed`/`sync` FCM push, and on
  a periodic background tick. Re-schedule on device reboot (`BOOT_COMPLETED`).
- **Server push is the backup**, not the primary fire path for native: it covers
  cross-device delivery, ad-hoc/just-created reminders, and escalation.

## Native alarm plugin (`apps/mobile`, Phase 4)

A custom Capacitor plugin (Kotlin) provides what `@capacitor/local-notifications`
cannot:

- `AlarmManager.setExactAndAllowWhileIdle` for exact, Doze-surviving alarms.
- On fire: a **foreground service** posting an **ongoing** notification
  (`setOngoing(true)`, `setAutoCancel(false)`) with a **full-screen intent**, and
  looping the alarm sound/vibration on the reminder's `soundIntervalSeconds`.
- Stops **only** when the user taps **Done** ("I took it"), which cancels the
  service + sound and `POST`s the ack to the API (queued if offline).
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

A reminder may escalate after N unacknowledged minutes (`lib/scheduler.ts`
sweep): re-push with an `alarm` flag to the user's own devices and/or email a
contact via Cloudflare (`lib/escalation-email.ts`). After a longer cutoff an
unacknowledged occurrence is marked `MISSED`.

## Residual risk

Aggressive OEM battery managers (Xiaomi, Samsung, etc.) can still defer alarms.
We mitigate with exact alarms + foreground service + the battery-exemption
prompt, and document the residual risk to users.
