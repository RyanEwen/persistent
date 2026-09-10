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

- `apps/mobile` and `apps/desktop` sit in the tree outside the npm **workspaces**
  graph (the first has its own `package.json` but is not listed in the root
  `workspaces`, the second is C# and has none).
- **`apps/api`** owns auth, reminder CRUD, the scheduling/escalation engine, push
  delivery, and a per-user WebSocket at `/ws`.
- **`apps/mobile`**: Capacitor (Android) wrapper of the built web app plus a
  custom native alarm plugin. The web/PWA is best-effort; the native app is the
  real persistence guarantee. See `docs/alarm-architecture.md`.
- **`apps/desktop`**: WinUI 3 (C#) Windows tray app that shows the **hosted PWA**
  in a WebView2 flyout. A viewing/acting surface, and deliberately not the
  persistence guarantee: no alarm audio, no badge, nothing while the app is closed
  or the machine asleep. Hosting the real bundle is what stops it drifting from the
  done/silence/snooze contract. **Optional** Windows toasts (off by default) are the
  one signal it offers, raised by the host from its own `/ws` connection: the page
  is suspended while the flyout is hidden, so it can't deliver anything. See
  `docs/desktop-architecture.md`.
- **`packages/shared`**: the single source of truth for request/response shapes;
  do not duplicate them elsewhere.

## The persistence reality (read before touching notifications)

Truly undismissable notifications and repeating alarm sound while the app is
closed are **native-OS capabilities**, not web/PWA ones. The model is
**device-scheduled + server backup**: the server is the source of truth and
materializes occurrences; the native client schedules on-device exact alarms so
they fire offline; server push (Web Push + FCM) is the cross-device / escalation
/ ad-hoc backup. Don't try to make the web PWA a hard alarm: it is intentionally
best-effort (`requireInteraction` + re-fire on dismissal in the service worker).

## Core data model

`Reminder` is the definition a user manages; the scheduler expands it into
independent `ReminderOccurrence` rows, one per firing. A live obligation is an
occurrence that is `FIRED` and not yet `ACKNOWLEDGED`. The schedule kinds `none`
(remind now) and `never` (a note) are both timeless but deliberately behave
differently. Read `.agents/guides/reminder-model.md` before changing reminder
types, checklists, notes, schedule transitions, occurrence lifecycle, or
notification content.

## Code style

- TypeScript everywhere; keep strict mode intact. `verbatimModuleSyntax` is on,
  so use `import type` for type-only imports.
- Keep modules focused and small. Non-trivial modules carry a short JSDoc header
  naming what they own and any non-obvious invariants.
- ASCII unless the file already needs Unicode.
- Names must track function: rename when behavior shifts.

## Data isolation (the one rule)

There is no multi-tenancy. Ownership is per-user: **every query for a domain row
must filter by the authenticated `userId`** (`requireUserId(request)`). This is
the entire data-isolation boundary. See `docs/auth-architecture.md` and the
directory guide `apps/api/AGENTS.md`.

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

- The devcontainer (Node 20 + Postgres `db` service) is the complete development
  environment. Optional `@ryanewen/devkit` host mode supports concurrent
  checkouts; it disables itself inside the devcontainer, which retains fixed
  ports and networking. The web build's service-worker generation needs Node 20.
- `npm run dev`: shared (watch) + api + web concurrently.
- `npm run db:migrate`: create/apply Prisma migrations. Regenerate the client
  (`npm run db:generate`) and update shared contracts when the schema changes.
  **Never point `prisma migrate diff --shadow-database-url` at `DATABASE_URL`.**
  Prisma resets the shadow database, so that wipes the dev data. `prisma migrate
  status` answers "is the schema in step?" without touching anything.
- `npm run db:seed`: fill a dev account with reminders covering every type,
  schedule kind and occurrence state (due, escalated, snoozed, orphaned, part-ticked
  checklist, a checklist left collapsed, paused, history). It replaces that
  user's reminders only; the account,
  passkeys and sessions survive, so it never signs you out. `-- --keep` to append,
  `-- --email=…` to pick the user.
- Before finishing a task run `npm run validate` (lint + test + typecheck +
  prisma validate). Add focused tests for non-trivial behavior. **It needs no
  database and no `DATABASE_URL`**: `prisma validate` only parses the schema, but
  it still refuses to start without the variable its datasource interpolates, so
  `apps/api`'s `prisma:validate` script supplies a placeholder when the real one is
  absent (`${DATABASE_URL:-...}`, so a set value always wins). Nothing is masked:
  the command never connects, and a malformed schema still fails. This matters
  because the variable comes from `devcontainer.json`'s `containerEnv`, which not
  every shell inherits, and the whole check used to die on a missing value having
  tested nothing.
- `npm test` discovers `*.test.ts` under `apps/`, `packages/` **and `scripts/`**.
  The last is for repo-hygiene checks belonging to no single workspace: currently
  that the lockfile's recorded workspace versions match their `package.json`
  (`scripts/dev/workspace-versions.test.ts`), since a version bump doesn't
  regenerate the lockfile on its own. Fix with `npm install --package-lock-only`.
- **`npm run validate` covers neither native surface.** Kotlin/Java changes have
  their own compile check (`apps/mobile/AGENTS.md`) and the C# desktop app has its
  own too, plus a CI job (`apps/desktop/AGENTS.md`). Neither is optional before
  finishing. For the desktop app, **compiling is not the check that matters**:
  `npm run install:desktop` builds the working tree into a dev-signed MSIX on the
  Windows machine and installs it, which is the only thing that sees XAML, packaging
  and whether the app still starts.

## How project guidance is organized for Codex

- This root `AGENTS.md` is always loaded.
- Directory-scoped conventions live in nested `AGENTS.md` files and load for
  work in that subtree. List them with `git ls-files '*AGENTS.md'`.
- Reusable workflows live in `.agents/skills/` and are invoked as `$commit`,
  `$deploy`, `$release`, `$audit-docs`, and `$verify`.
- `.agents/guides/reminder-model.md` contains the detailed reminder and
  occurrence invariants extracted from this always-loaded file.
- Cross-cutting sources of truth live in `docs/`: `auth-architecture.md`,
  `data-event-contract.md`, `alarm-architecture.md`,
  `notification-behavior.md`, and `desktop-architecture.md`. Read the relevant
  contract before related work.
