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

- Node.js + TypeScript monorepo, npm workspaces: `apps/api`, `apps/web`,
  `apps/mobile`, `packages/shared`.
- **`apps/api`** — Express + Prisma + PostgreSQL. Owns auth, reminder CRUD, the
  scheduling/escalation engine, push delivery, and a per-user WebSocket at `/ws`.
- **`apps/web`** — Vite + React + Joy UI PWA. Loads data over HTTP, subscribes to
  `/ws` for live updates fed into TanStack Query.
- **`apps/mobile`** — Capacitor (Android) wrapper of the built web app plus a
  custom native alarm plugin. The web/PWA is best-effort; the native app is the
  real persistence guarantee. See `docs/alarm-architecture.md`.
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

**A reminder with no date/time is a real stored state**, schedule kind `none` —
the editor's "Remind me now" (the default for a new reminder, versus "Schedule
it"). It fires exactly once, anchored to the reminder's `createdAt`, and never
again: `materializeReminder` short-circuits on `none` and the
`@@unique([reminderId, scheduledFor])` makes repeat passes idempotent. `startDate`
on such a reminder is only a record of when it was created.

Giving an unscheduled reminder a real schedule **retires its immediate firing**
(`PUT /api/reminders/:id`) — that firing was an artifact of having no schedule,
not a commitment to a date. This is the one exception to "only Done clears a
firing"; an edit between two *real* schedules never clears an unconfirmed one
(see `docs/notification-behavior.md` §1, and §6 for how the UI labels a firing
that a later reschedule left behind).

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
- Before finishing a task run `npm run validate` (lint + test + typecheck +
  prisma validate). Add focused tests for non-trivial behavior.
- **Native (Kotlin/Java) changes** aren't covered by `npm run validate`. The
  devcontainer ships JDK 17 + the Android SDK (platform-34, build-tools 34.0.0),
  so verify them by compiling: from `apps/mobile`, `npm run verify:android`
  (re-syncs `android-plugin/` into the generated project, then compiles the Kotlin
  **and** Java tasks for **both product flavors**). All four tasks matter — the
  plugin is Kotlin but `MainActivity.java` is Java, and the Kotlin task alone
  compiles right past a broken `MainActivity`. Run `npm run prepare:android` once
  first if the generated `apps/mobile/android` project doesn't exist yet.
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
  `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `packages/shared/CLAUDE.md`.
- Cross-cutting contracts live in `docs/`: `auth-architecture.md`,
  `data-event-contract.md`, `alarm-architecture.md`, `notification-behavior.md`
  (the done/silence/snooze + independent-occurrence guarantee). Read the relevant
  one before related work.
- Repeatable workflows are `.claude/commands/` slash commands: `/commit`
  (review + validate + commit), `/deploy` (commit + push + SSH-Docker deploy),
  `/release` (version-bump + tag; CI builds both Android flavors — signed APK to
  a GitHub Release, AAB to Google Play),
  and `/audit-docs` (resync docs with the code).
