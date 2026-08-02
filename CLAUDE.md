# Persistent

## What this is

A reminder app whose defining feature is **persistence**: a reminder nags (a
notification that won't dismiss, re-fires after dismissal, optional repeating
alarm sound) until the user **explicitly confirms completion**, with optional
**escalation** of ignored reminders (own devices + an email contact). Hosted web
service (public sign-ups) + a native Android client where the hard alarm
guarantees live.

Architecture and conventions are borrowed, thinned, from the sibling
`../printstream` monorepo.

## Architecture

- Node.js + TypeScript monorepo. The npm **workspaces** are `apps/api`,
  `apps/web` and `packages/shared`; `apps/mobile` and `apps/desktop` sit in the
  tree outside that graph (the first has its own `package.json` but is not listed
  in the root `workspaces`, the second is C# and has none).
- **`apps/api`** — Express + Prisma + PostgreSQL. Owns auth, reminder CRUD, the
  scheduling/escalation engine, push delivery, and a per-user WebSocket at `/ws`.
- **`apps/web`** — Vite + React + Joy UI PWA. Loads data over HTTP, subscribes to
  `/ws` for live updates fed into TanStack Query.
- **`apps/mobile`** — Capacitor (Android) wrapper of the built web app plus a
  custom native alarm plugin. The web/PWA is best-effort; the native app is the
  real persistence guarantee. See `docs/alarm-architecture.md`.
- **`apps/desktop`** — WinUI 3 (C#) Windows tray app that shows the **hosted PWA**
  in a WebView2 flyout. A viewing/acting surface, and deliberately not the
  persistence guarantee: no alarm audio, no badge, nothing while the app is closed
  or the machine asleep. Hosting the real bundle is what stops it drifting from the
  done/silence/snooze contract. **Optional** Windows toasts (off by default) are the
  one signal it offers, raised by the host from its own `/ws` connection — the page
  is suspended while the flyout is hidden, so it can't deliver anything. See
  `docs/desktop-architecture.md`.
- **`packages/shared`** — Zod schemas + inferred types used by API and web. Do
  not duplicate request/response shapes elsewhere.
- PostgreSQL via Prisma; migrations under `apps/api/prisma/migrations/`.

## The persistence reality (read before touching notifications)

Truly undismissable notifications and repeating alarm sound while the app is
closed are **native-OS capabilities**, not web/PWA ones. The model is
**device-scheduled + server backup**: the server is the source of truth and
materializes occurrences; the native client schedules on-device exact alarms so
they fire offline; server push (Web Push + FCM) is the cross-device / escalation
/ ad-hoc backup. Don't try to make the web PWA a hard alarm — it is intentionally
best-effort (`requireInteraction` + re-fire on dismissal in the service worker).

## Core data model

A reminder's **`type`** (`NONE` / `TODO` / `MEDICATION`) selects the extra fields
it carries in **`typeData`** — a medication's doses, a `TODO`'s checklist `items`.
(It was called `category`/`categoryData` until the type started selecting behavior
rather than just an icon. `TASK` and `APPOINTMENT` were dropped in the same pass:
they selected nothing, so they were an icon pretending to be a type.) A `TODO` is a single
reminder covering several items; the items belong to the reminder, but **which of
them are ticked belongs to the occurrence** (`ReminderOccurrence.checkedItems`), so
a repeating checklist starts each firing blank. Ticking every item does *not*
acknowledge the firing — only Done does (`docs/notification-behavior.md` §1a).
**A note is the one exception**: it has no occurrences, so its ticks live on the
reminder (`Reminder.checkedItems`, written by `POST /api/reminders/:id/check`) —
legitimate precisely because there is no firing whose record they could contradict.
The server rejects that endpoint for anything that is not a note, and clears the
column the moment one gains a schedule.

`Reminder` (the definition the user manages) → expanded by the scheduler into
`ReminderOccurrence` rows (one per firing). The persistence guarantee = an
occurrence is `FIRED` and not yet `ACKNOWLEDGED`. **Every occurrence is
independent**: a reminder with several times of day (or one that repeats) fires,
nags, and is confirmed one occurrence at a time — an unconfirmed 9:00 dose does
not suppress the 13:00 dose, and confirming 13:00 does not clear 9:00. (The legacy
`SUPERSEDED` status is no longer produced; old rows may still carry it.) The
guaranteed user-facing behavior of done / silence / snooze / independent
occurrences is specified in `docs/notification-behavior.md`. See also
`packages/shared/src/reminders.ts`.

The Schedule tab's **When** setting is the three answers to "when does this
fire?", and each is a real stored schedule kind: `none` ("Remind me now" — the
default for a new reminder), a real schedule ("Schedule it"), and `never`
("Never — just a note").

**A reminder that never fires is a real stored state too**, schedule kind
`never` — a **note**. It has no occurrences at all, so nothing about it can nag,
escalate or need confirming; the shared schema rejects escalation on one outright,
and the editor's Notifications and Escalation tabs explain themselves instead of
offering settings. Notes are still reminders in every other way (type, checklist,
medications, details), so a `TODO` note is a kept list rather than a routine. They
are listed under their own heading on **Current**, below the attention cards — the
screen the app opens on, so where reference material is to hand — and never on
Upcoming, since nothing about a note is upcoming. **Turning a reminder into a note retires whatever
it left nagging**: the user has said this thing does not remind, and unlike an
ordinary reschedule there is no later firing to carry the obligation forward to.
`none` and `never` are the two kinds carrying no time of day (`isTimeless`), and
materialization expands neither.

**A reminder with no date/time is a real stored state**, schedule kind `none` —
the editor's "Remind me now" (the default for a new reminder, versus "Schedule
it"). It gets exactly one firing, ever. That firing is minted by
`ensureUnscheduledFiring` at the moment the user asks for it (creating a reminder
unscheduled, or taking an existing one's schedule away) and **never by
materialization**: `materializeReminder` short-circuits on `none` precisely
because it runs every 5 minutes, so anything it created there would come back
after the user confirmed it. `startDate` on such a reminder is only a record of
when it was last saved as unscheduled — it is not a window, and nothing reads it
(see `isOutsideReminderWindow`).

Moving between a real schedule, no schedule and a note is special, and
`scheduleTransition` names each move (`PUT /api/reminders/:id`):

- **Gaining a real schedule retires the immediate firing.** It was an artifact of
  having no schedule, not a commitment to a date. This is one of the two
  exceptions to "only Done clears a firing".
- **Becoming a note retires every live firing.** The other exception, and for a
  different reason: those firings were real, but the reminder no longer reminds.
- **Losing its schedule mints the immediate firing — unless one is already
  nagging.** Whatever the old schedule left unconfirmed still stands, so adding a
  second would show the same reminder twice with nothing on either card to tell
  them apart (an unscheduled firing has no time to show).

An edit between two *real* schedules never clears an unconfirmed firing, and
neither does editing an unscheduled reminder in place (see
`docs/notification-behavior.md` §1, and §6 for how the UI labels a firing that a
later reschedule left behind).

`none` was previously a UI-only mode faked as a `once` schedule at the creation
instant, which meant it could not round-trip through the editor and left an
orphaned "Due" firing whenever the reminder was later rescheduled.

## Code style

- TypeScript everywhere; keep strict mode intact. `verbatimModuleSyntax` is on,
  so use `import type` for type-only imports.
- Keep modules focused and small. Non-trivial modules carry a short JSDoc header
  naming what they own and any non-obvious invariants.
- ASCII unless the file already needs Unicode.
- Names must track function — rename when behavior shifts.

## Data isolation (the one rule)

There is no multi-tenancy. Ownership is per-user: **every query for a domain row
must filter by the authenticated `userId`** (`requireUserId(request)`). This is
the entire data-isolation boundary. See `docs/auth-architecture.md` and the
directory guide `apps/api/CLAUDE.md`.

## Shared helpers (do not duplicate)

- API HTTP errors: throw `HttpError`/`badRequest`/`notFound`/… from `apps/api/src/lib/http-error.ts`.
- API env: import `env` from `apps/api/src/lib/env.ts`; never read `process.env` in feature code.
- Prisma: import `prisma` from `apps/api/src/lib/prisma.ts`.
- Realtime: `broadcast(userId, event)` from `apps/api/src/lib/realtime.ts`.
- Push: `dispatchToUser(userId, payload)` from `apps/api/src/lib/delivery/`.
- Email: `sendCloudflareEmail` from `apps/api/src/lib/cloudflare-email.ts`.
- Web HTTP: `apiFetch` from `apps/web/src/lib/apiClient.ts` (never bare fetch for JSON).
- Web realtime/caches: WS events invalidate TanStack Query keys (`apps/web/src/lib/wsClient.ts`); do not poll in components.

## Build & validation

- Development is **devcontainer-only** (Node 20 + Postgres `db` service). The web
  build's service-worker generation needs Node 20.
- `npm run dev` — shared (watch) + api + web concurrently.
- `npm run db:migrate` — create/apply Prisma migrations. Regenerate the client
  (`npm run db:generate`) and update shared contracts when the schema changes.
  **Never point `prisma migrate diff --shadow-database-url` at `DATABASE_URL`** —
  Prisma resets the shadow database, so that wipes the dev data. `prisma migrate
  status` answers "is the schema in step?" without touching anything.
- `npm run db:seed` — fill a dev account with reminders covering every type,
  schedule kind and occurrence state (due, escalated, snoozed, orphaned, part-ticked
  checklist, paused, history). Replaces that user's reminders only — the account,
  passkeys and sessions survive, so it never signs you out. `-- --keep` to append,
  `-- --email=…` to pick the user.
- Before finishing a task run `npm run validate` (lint + test + typecheck +
  prisma validate). Add focused tests for non-trivial behavior.
- `npm test` discovers `*.test.ts` under `apps/`, `packages/` **and `scripts/`**.
  The last is for repo-hygiene checks belonging to no single workspace — currently
  that the lockfile's recorded workspace versions match their `package.json`
  (`scripts/dev/workspace-versions.test.ts`), since a version bump doesn't
  regenerate the lockfile on its own. Fix with `npm install --package-lock-only`.
- **Native (Kotlin/Java) changes** aren't covered by `npm run validate`. The
  devcontainer ships JDK 17 + the Android SDK (platform-34, build-tools 34.0.0),
  so verify them by compiling: from `apps/mobile`, `npm run verify:android`
  (re-syncs `android-plugin/` into the generated project, then compiles the Kotlin
  **and** Java tasks for **both product flavors**). All four tasks matter — the
  plugin is Kotlin but `MainActivity.java` is Java, and the Kotlin task alone
  compiles right past a broken `MainActivity`. Run `npm run prepare:android` once
  first if the generated `apps/mobile/android` project doesn't exist yet.
- **Windows (C#/WinUI 3) changes** aren't covered by `npm run validate`. The app
  cannot be *built* here — the Windows App SDK's XAML compiler and `MakePri.exe`
  are Windows-only binaries — so `.github/workflows/build-desktop-msix.yml`
  (`windows-2025`, every push/PR touching `apps/desktop`) is the only complete
  check; treat a red run there as a failed validate. The devcontainer does ship
  the .NET SDK, though, so `npm run verify:desktop` compiles the app's **non-XAML**
  C# against the real Windows App SDK reference assemblies. That catches a
  misremembered WinRT API without a CI round-trip; it checks no XAML, no
  code-behind and no packaging. Local builds are Windows-side:
  `dotnet build Persistent.Desktop/Persistent.Desktop.csproj -c Debug`, packaged
  with `Persistent.DesktopMSIX/build-msix.ps1`. Desktop releases are tagged
  `desktop-vX.Y.Z` so they don't collide with the Android `vX.Y.Z` tags.
- **Two Android flavors** (`apps/mobile/android-plugin/flavor/`): `play` for the
  Play Store, `direct` for sideloaded GitHub releases. They differ only in the
  in-app updater — `direct` registers `UpdatePlugin` and declares
  `REQUEST_INSTALL_PACKAGES`; `play` has neither, because Play forbids an app it
  distributes from updating itself. `MainActivity` is shared and calls
  `FlavorPlugins.register(this)`, which each flavor supplies. Build with
  `npm run assemble:release` (direct APK) or `npm run bundle:play` (Play AAB).
  Both flavors load the *same* hosted web bundle, so any updater UI must gate on
  `hasNativeUpdater()` (`apps/web/src/native/alarmBridge.ts`), never `isNative()`.

## How guidance is organized

- This root `CLAUDE.md` is always loaded.
- Directory-scoped conventions load when you read/edit files there:
  `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `apps/desktop/CLAUDE.md`,
  `packages/shared/CLAUDE.md`.
- Cross-cutting contracts live in `docs/`: `auth-architecture.md`,
  `data-event-contract.md`, `alarm-architecture.md`, `notification-behavior.md`
  (the done/silence/snooze + independent-occurrence guarantee),
  `desktop-architecture.md`. Read the relevant one before related work.
- Repeatable workflows are `.claude/commands/` slash commands: `/commit`
  (review + validate + commit), `/deploy` (commit + push + SSH-Docker deploy),
  `/release` (version-bump + tag; CI builds both Android flavors — signed APK to
  a GitHub Release, AAB to Google Play's `internal` + `alpha` tracks),
  and `/audit-docs` (resync docs with the code).
