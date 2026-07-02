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
- **The device schedules its own alarms.** `GET /api/sync/occurrences` returns the
  exact alarms to arm — the server expands each occurrence into a main fire plus, if
  escalation is pending, an escalation alarm (`apps/api/src/lib/device-alarms.ts`),
  so the occurrence→alarm transform lives in exactly one place. The JS bridge
  (`apps/web/src/native/`, bundled into the web app and started after sign-in by
  `useAuth`) arms those on-device exact alarms, filling only the device-local sound
  URI, so reminders fire **even offline** and even if the server is unreachable.
- **The device keeps its own schedule fresh, autonomously.** Refreshes come from
  three places: **live on every WS event** (`reminder.changed` / `occurrence.*`) and
  on app resume (foreground); reboots re-schedule via `BOOT_COMPLETED`; and — the
  backstop that needs neither the WebView nor a push — a **WorkManager
  `SyncWorker`** (`apps/mobile/android-plugin/SyncWorker.kt`) that re-pulls and
  re-arms on a ~15-minute cadence and whenever connectivity returns. It runs with
  the app fully closed: `SyncClient` reads the session cookie straight from the
  WebView cookie jar (the app is loaded from the API origin) and calls the same sync
  endpoint in Kotlin. The WebView mirrors the API origin + chosen sound URIs into
  native storage on each foreground sync (`AlarmPlugin.setSyncConfig`) so the worker
  has what it needs. A full resync also **reconciles the posted notifications**
  against the server's set: `scheduleAll` drops any live notification whose
  occurrence is no longer returned (`AlarmService.cancelMissing`) and refreshes the
  text/channel of the survivors (`refreshActive`). Ack/snooze/delete elsewhere
  broadcast `dismiss`, which the bridge turns into a native cancel so a
  cleared/deleted reminder's alarm stops on every device; native acks/snoozes/
  silences taken while the WebView was dead are drained to the server by the worker
  too. This is how a device catches up on dismisses/edits it missed while closed —
  e.g. an occurrence acked/deleted on another device, or a reminder renamed — so it
  can't show a stale or duplicate nag.
- **Server push is insurance, not a trigger.** On-device alarms fire the reminder;
  push only lets a change reach a closed device *sooner* than the next periodic
  sync, plus covers cross-device delivery. A total push outage therefore only
  staggers freshness by up to the sync interval — it never stops an alarm from
  firing. (This is deliberate: a silent FCM auth failure once left push 100% dead,
  and because the periodic worker did not yet exist, closed devices went dark until
  reopened. The worker removes that dependency.)

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
    alarm sound + vibration (no interval; it's relentless). Like the system clock's
    alarm, the full-screen `AlarmActivity` is kept on screen whether locked or not:
    the full-screen intent covers the screen-off / lock-screen case, and when the
    device is unlocked and in use (where Android would otherwise only show a
    heads-up banner that collapses after a few seconds) the service launches the
    activity itself. If notifications are disabled outright (`POST_NOTIFICATIONS`
    denied) there is no shade surface at all, so the service force-launches the
    full-screen activity unconditionally — an alarm must never ring with nothing
    visible to identify or stop it. The alarm notification's body tap opens that same control
    surface (not the app), and `Back` on it is inert — only Done/Snooze leave.
    Because that surface is a separate window from the shade notification, the
    service finishes it (a `ca.persistent.app.ALARM_ACTIVITY_DISMISS` broadcast the
    activity listens for) whenever the occurrence is silenced, acked, snoozed, or
    cleared from *another* surface — the shade action or another device — so it
    can't linger on screen as a stale second alert after the alarm is handled.
  - Swiping a notification away **re-posts all active ones** (delete-intent) so
    they can't be casually dismissed (even when several are swiped together); only
    Done/Snooze clear them.
  - **Silent keep-alive (survives process death).** A soft nag's notification is
    held by the foreground service, so if the OS kills that service/process
    (swipe-from-recents, memory pressure, an app update, or an FGS timeout) its
    notification is removed — and a one-shot's alarm has already fired, so nothing
    re-posts it. `AlarmService.ensureNags` closes that gap: it re-posts any overdue
    soft nag whose notification isn't showing, **silently** (no re-sound), from the
    persisted `AlarmStore` — so a nag stays until Done. It runs on every resync and,
    critically, on the background `SyncWorker` cadence (~15 min) and offline, since it
    reads the local store. Because re-asserting is silent, `scheduleAll` no longer
    re-fires a past-due soft occurrence (which would re-sound on every resync) — only
    a past-due **alarm/escalation** still re-fires, because those must ring, not
    appear quietly. (Genuine on-time fires still sound: they ring from the alarm
    armed ahead of their scheduled time.)
  - Each occurrence gets its **own notification id**, so multiple due reminders
    show at once (the foreground service rebinds to a remaining one as they clear).
  - **Snooze** opens a duration picker (`SnoozePickerActivity`) offering presets, a
    custom number + unit, or "until" a specific date + time (converted to minutes
    from now, capped at `MAX_SNOOZE_MINUTES`); the chosen minutes are re-armed
    locally and queued to the server (`PendingSnoozeStore`).
  - **Silence** (escalation alarms only) stops the loud alarm but keeps the
    reminder nagging: it downgrades the on-device alarm to a soft, ongoing
    notification, queues a silence for the server (`PendingSilenceStore`), and the
    occurrence reverts `ESCALATED → FIRED` with re-escalation permanently suppressed
    for that occurrence (`escalationSilencedAt`). It is *not* a Done — only Done
    (ack) or Snooze clear the nag. Inherent `ALARM`-persistence reminders don't
    show Silence (no softer level to fall back to); the `canSilence` flag on the
    scheduled alarm gates the action.
- **Sounds are user-chosen** (per device): `pickSound` opens the system ringtone
  picker; the chosen URIs are stored in settings and passed through as the
  alarm/notification tone (system default otherwise). The service plays audio
  itself (silent channel) so each tone is honored.
- Stops **only** on **Done**, a deliberate **two-tap confirm** on every surface
  (notification, full-screen `AlarmActivity`, and the in-app card): the first tap
  swaps the controls to *Confirm done* / *Not yet* (the alarm keeps ringing) so an
  accidental pocket tap can't dismiss the nag; the confirm tap cancels the service
  + sound and `POST`s the ack (queued offline via `PendingAckStore` on native).
  **Done never opens the app** — the queued ack is delivered to the server the next
  time the WebView runs (app open / resume / WS event), so another device may keep
  nagging until then.
- A `BOOT_COMPLETED` receiver re-schedules pending alarms from the local mirror.

Permissions: `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, `POST_NOTIFICATIONS`,
`FOREGROUND_SERVICE` (+ `_SPECIAL_USE`), `USE_FULL_SCREEN_INTENT`, `WAKE_LOCK`,
`RECEIVE_BOOT_COMPLETED`; prompt for battery-optimization exemption. On Android
14+ `USE_FULL_SCREEN_INTENT` is a user-grantable runtime permission (off by
default for non-calling/alarm apps), so `AlarmPlugin.ensureFullScreenIntent()`
checks `canUseFullScreenIntent()` and opens the per-app setting to grant it —
without it the escalation only shows a heads-up banner that collapses instead of
the full-screen alarm. The alarm notification is `VISIBILITY_PUBLIC` so its
content shows on the lock screen (the user can see which reminder is firing).
`AlarmPlugin.alarmReadiness()` reports whether notifications / full-screen /
exact-alarm are actually grantable; if `POST_NOTIFICATIONS` is denied the app
warns on startup (`warnIfAlarmsCantShow`), because a fired alarm would otherwise
sound with no shade surface — and the native force-launch above is the last-resort
backstop, not a substitute for the grant.

## Notification shade prominence

Independently of *how hard* a reminder nags, the user controls *how prominently*
its notification sits in the Android shade — **visual only; it does not change the
sound** (the service plays the tone itself via MediaPlayer, so channel importance
never gates audio). The native client posts to one of three silent channels:

- `reminders_silent` (legacy id, "Alarms & escalations", `IMPORTANCE_HIGH`,
  bypasses DND) — every `alarm`/escalation, always prominent regardless of the
  setting.
- `reminders_normal` ("Reminders", `IMPORTANCE_HIGH`) — main shade area, may pop
  up a heads-up banner.
- `reminders_minimized` ("Reminders (minimized)", `IMPORTANCE_LOW`) — collapsed
  "silent" section at the bottom of the shade, no pop-up.

The non-minimized notifications are bundled under one **notification group** + a
summary (`updateGroupSummary`), so several active reminders collapse to a single
status-bar icon instead of one per reminder. The summary is silent
(`GROUP_ALERT_CHILDREN`, so it never steals a child's heads-up/full-screen) and is
posted only when two or more share the group. Minimized notifications stay
ungrouped — `IMPORTANCE_LOW` shows no status-bar icon, so they need no collapsing.

The level is chosen per non-alarm notification by `channelFor(spec)`: a reminder's
own `shadeProminence` (`NORMAL`/`MINIMIZED`), or — when `INHERIT` — the **device
default** stored in `AlarmStore` (`SettingsPage` -> `setDefaultShadeProminence` ->
`AlarmService.setDefaultProminence`). `shadeProminence` is a server-side reminder
field (shared `shadeProminenceSchema` <-> Prisma `ShadeProminence`), so per-reminder
choices sync across devices; the device default is a per-device localStorage pref
pushed to native on startup and on change.

A notification's channel can't change on an in-place `notify()`, so a prominence
change re-posts the affected live notifications (cancel + re-post, the
foreground-bound one detached first; `postedAt`/`sortKey` retained so positions
hold and no sound replays):

- **Device default** changed -> `ACTION_RESTYLE` -> `restyleActive` re-posts every
  active notification immediately.
- **Per-reminder** value changed (or the reminder was renamed / its body edited) ->
  the next resync's `scheduleAll` calls `AlarmService.refreshActiveStyles`
  (`ACTION_REFRESH` -> `refreshActive`), which reloads each active spec from
  `AlarmStore` and re-posts those whose title/body changed (in place) or whose
  channel changed (cancel + re-post). (Without this, an in-place re-post — including
  the swipe-away reshow — would leave a live notification stranded on its old
  channel or showing the pre-edit text.)

## Push channels

- **Web Push (VAPID)** for browsers — `apps/api/src/lib/delivery/web-push.ts`.
- **FCM (HTTP v1)** for native Android — `apps/api/src/lib/delivery/fcm-push.ts`.
  The dispatcher (`delivery/index.ts`) targets each device by
  `PushSubscription.kind`; `dispatchToUser` fans `fire`/`escalate`/`dismiss`/
  `silence` to all channels, and `nudgeNativeSync` sends an FCM-only `sync` on
  reminder create/update/delete (skipping Web Push, which would surface a blank
  "site updated" notification; open web clients already converge over `/ws`).

On native, FCM is handled by `FcmService` (Kotlin) — it subclasses
`@capacitor/push-notifications`' `MessagingService` and is registered in its place
(`setup-android.mjs` merges the manifest service + drops Capacitor's), so it acts on
the **self-contained data payload even when the WebView/bridge is dead**: `dismiss`
clears the nag, `fire`/`escalate` show it, `silence` downgrades it; it then calls
`super()` so the JS bridge still receives the message when alive (token hand-off in
`nativeSync.ts` `initFcm`, plus a resync). A pushed `fire` falls back to default
sound/prominence (those live in WebView settings), so the on-device scheduled alarm
remains the full-fidelity primary path — and precisely because of that, a `fire`/
`escalate` push is **suppressed when the occurrence is already handled locally**
(`FcmService.handledLocally`: showing in the service, or still armed in `AlarmStore`
as the base alarm or its `::esc` escalation). Otherwise a device that scheduled the
occurrence locally would double-alert — once with the chosen tone (the exact alarm)
and again with the default tone (the push). The push only acts when the device has
no local alarm for it (web-only, never synced, or a cross-device nudge). As a
belt-and-suspenders backstop for any trigger the `handledLocally` check can't see
(a process killed between the local alarm and the push, a resync re-arm across
death, etc.), `AlarmService` also **debounces the sound per occurrence**: it won't
re-play the same occurrence's tone within a few minutes (`SOUND_DEBOUNCE_MS`,
persisted in `AlarmStore` so it survives a restart, reset on ack/snooze). The
notification still (re)posts; only the near-simultaneous *second sound* is dropped.
The intentional `soundIntervalSeconds` re-notify loop plays directly and is exempt.

**Both halves are gated and OFF until provisioned:** the server only sends FCM when
`FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_FILE` are set (`isFcmConfigured`), and
`initFcm` only calls `PushNotifications.register()` when the server reports
`fcmEnabled` (registering without `google-services.json` hard-crashes natively). The
generated `app/build.gradle` applies the google-services plugin only when
`google-services.json` is present, so the APK builds fine without it (FCM inert).

## Escalation

A reminder may **escalate to an alarm** if unacknowledged — either N minutes
after firing (`escalateAfterMinutes`) or at a specific wall-clock time
(`escalateAtTime`, user-tz aware). The escalation instant is always the first
occurrence of that time **at or after the firing**, rolling to the next day when
the wall-clock time is earlier than the firing (so a 23:45 reminder escalating at
`01:30` rings the next morning, not ~22h before it fires). Both the server sweep
and `/api/sync/occurrences` derive it from the same pure helper
(`lib/escalation.ts`). Escalation always rings an alarm on the user's
own devices and may **also email a contact** (`escalateEmail` +
`escalateEmailMessage`, sent once via `sendCloudflareEmail` on escalation). It
does **not** apply to `ALARM`-persistence reminders (they already ring
continuously — enforced in the shared schema).

A fired occurrence is **never** auto-expired: it stays `FIRED` (or `ESCALATED`)
until the user explicitly acknowledges it or deletes the reminder — that is the
persistence guarantee. The `MISSED` status still exists in the model for a
possible future *explicit* action, but the scheduler never assigns it on its own.

**Each occurrence is independent.** A reminder with several times of day (or one
that repeats) fires, nags, and is confirmed one occurrence at a time. If the 9:00
dose is still unconfirmed when 13:00 fires, both nag as separate notifications,
each with its own Done/Snooze/Silence, each acknowledged on its own — confirming
13:00 never clears 9:00. Every occurrence is keyed by its own occurrence id all
the way down (notification tag, native `notifId`, on-device alarm request code),
so nothing collapses across firings. (An earlier design auto-resolved older
firings to `SUPERSEDED` via `keepNewestForReminder`; that collapse was removed.
`SUPERSEDED` is now legacy-only — never assigned — and any old such rows live in
history, not the active feed.)

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
