# API conventions (`apps/api`)

- **Per-user scoping is mandatory.** Every query that reads or writes a domain
  row (`Reminder`, `ReminderOccurrence`, `PushSubscription`, `Device`,
  `Passkey`) must include `userId` in its `where` (the passkey *authentication*
  lookup by `credentialId` is the one exception — it's the anonymous login path
  that establishes the user). Get it with `requireUserId(request)`. For
  edit/delete, first `findFirst({ where: { id, userId } })` and 404 if missing —
  never trust a path id alone. `Setting` is the only intentionally global model.
- **Validate at the boundary.** Parse request bodies with the Zod schemas from
  `@persistent/shared` (e.g. `reminderInputSchema.safeParse`) and throw
  `badRequest` on failure. Don't hand-roll shape checks.
- **Errors:** throw `HttpError` and friends from `lib/http-error.ts`; the global
  handler in `app.ts` turns them into `{ error }` JSON. Express 5 forwards
  rejected promises automatically — async route handlers may throw directly.
- **Env:** import `env` (and `demoMode`, `clientOrigins`) from `lib/env.ts`.
- **Realtime + push on writes:** after mutating reminders/occurrences, call
  `broadcast(userId, …)` (`lib/realtime.ts`) so open clients refresh, and use the
  `dispatchToUser` / dismiss helpers so notifications stay in sync across devices.
- **Scheduler:** `lib/scheduler.ts` owns materialization, the tick loop, and the
  snooze/escalation/miss sweeps. On reminder create/update, materialize the
  changed reminder immediately (don't wait for the 5-min cycle); on update, drop
  `PENDING` occurrences first so the new schedule re-materializes cleanly.
- **Time zones:** schedule expansion is the only place that converts local
  times to instants — always go through `expandSchedule` (luxon, DST-correct),
  using the owning user's `timeZone`. Never construct firing instants ad hoc.
- **Serialization:** convert Prisma rows to client DTOs via `lib/serializers.ts`
  so the JSON matches the shared Zod schemas (dates as ISO strings, etc.).
- **Tests:** pure logic (schedule expansion, formatting) gets `*.test.ts` next to
  the module, run by Node's test runner via `npm test`.
