# API conventions (`apps/api`)

- **Per-user scoping is mandatory.** Every query that reads or writes a domain
  row (`Reminder`, `ReminderOccurrence`, `PushSubscription`, `Passkey`) must
  include `userId` in its `where` (the passkey *authentication*
  lookup by `credentialId` is the one exception — it's the anonymous login path
  that establishes the user). Get it with `requireUserId(request)`. For
  edit/delete, first `findFirst({ where: { id, userId } })` and 404 if missing —
  never trust a path id alone. `Setting` is the only intentionally global model.
  `EmailCode` is keyed by **email rather than `userId`** (it predates the user it
  signs up), so it is neither user-scoped nor cascade-deleted — scope it by the
  authenticated user's own stored email, and remember it when deleting an account
  (`docs/auth-architecture.md`).
- **Validate at the boundary.** Parse request bodies with the Zod schemas from
  `@persistent/shared` (e.g. `reminderInputSchema.safeParse`) and throw
  `badRequest` on failure. Don't hand-roll shape checks.
- **Errors:** throw `HttpError` and friends from `lib/http-error.ts`; the global
  handler in `app.ts` turns them into `{ error }` JSON. Express 5 forwards
  rejected promises automatically — async route handlers may throw directly.
- **Env:** import `env` (and `demoMode`, `clientOrigins`) from `lib/env.ts`. Adding
  a variable takes **two** edits: the schema in `lib/env.ts` *and* the api
  service's `environment:` block in `compose.server.yml`, which enumerates what the
  container actually gets (the host `.env` is not copied into the image). A key in
  one but not the other is silently `undefined` in production; `lib/env.test.ts`
  fails the build if they drift. Optional vars arrive from compose as `""`, not
  absent — wrap validators like `.email()`/`.min()` in `blankToUndefined`.
- **Realtime + push on writes:** after mutating reminders/occurrences, call
  `broadcast(userId, …)` (`lib/realtime.ts`) so open clients refresh, and use the
  `dispatchToUser` / dismiss helpers so notifications stay in sync across devices.
  On reminder writes (which have no fire/dismiss payload) also call
  `nudgeNativeSync(userId)` — an FCM-only `sync` so native devices re-pull
  `/api/sync/occurrences` (it skips Web Push; web converges over WS).
- **Scheduler:** `lib/scheduler.ts` owns materialization, the tick loop, and the
  snooze/escalation/miss sweeps. On reminder create/update, materialize the
  changed reminder immediately (don't wait for the 5-min cycle); on update, drop
  `PENDING` occurrences first so the new schedule re-materializes cleanly. The two
  **timeless** kinds are the exception (`isTimeless`): materialization deliberately
  expands nothing for an **unscheduled** reminder (kind `none`) — its single firing
  comes from `ensureUnscheduledFiring`, called only on the edits that ask for one
  (see `lib/schedule-transition.ts`) — and nothing at all for a **note** (kind
  `never`), which has no occurrences by definition. Never move either back into a
  materialization pass — a loop that re-creates a firing resurrects nags the user
  has confirmed. Turning a reminder into a note **retires** its live firings, one
  of only two edits allowed to clear an unconfirmed firing.
  Each
  occurrence is independent: a fresh fire (or revived snooze) never supersedes the
  reminder's other still-unconfirmed firings, so a reminder with several times of
  day shows one notification per fired occurrence, each acknowledged separately.
  (The old `keepNewestForReminder` collapse was removed; `SUPERSEDED` is now a
  legacy-only status the scheduler never assigns.) See
  `docs/notification-behavior.md` for the full done/silence/snooze contract.
- **Time zones:** schedule expansion is the only place that converts local
  times to instants — always go through `expandSchedule` (luxon, DST-correct),
  using the owning user's `timeZone`. Never construct firing instants ad hoc.
  `apps/web/src/lib/schedule-preview.ts` mirrors these rules for the editor's
  "fires next" line — a new schedule kind has to land in both, or the preview
  quietly disagrees with what the server will do.
- **Serialization:** convert Prisma rows to client DTOs via `lib/serializers.ts`
  so the JSON matches the shared Zod schemas (dates as ISO strings, etc.).
- **Tests:** pure logic (schedule expansion, formatting) gets `*.test.ts` next to
  the module, run by Node's test runner via `npm test`.
