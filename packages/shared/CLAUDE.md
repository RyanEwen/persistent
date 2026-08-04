# Shared conventions (`packages/shared`)

- This package is the **single source of truth** for request/response shapes and
  domain types. If the API and web both need a shape, it goes here as a Zod
  schema plus its inferred type — never duplicated in either app.
- Schemas, inferred types, and **pure** domain helpers (e.g. the display-text
  formatters like `reminderBodyText`/`formatMedications`) that both runtimes need.
  No Node or browser APIs, no Prisma, no I/O — it's imported by both runtimes.
  Keep `zod` as the only runtime dependency.
- Keep enum string-literal unions (e.g. `reminderTypes`) in lockstep with
  the Prisma enums of the same name in `apps/api/prisma/schema.prisma`.
- `reminderTypes` is every type a reminder can be **stored** as;
  `selectableReminderTypes` is the subset the editor **offers**. They differ right
  now because `MEDICATION` is temporarily withheld (Play needs an organization
  account for health data — see the root `CLAUDE.md`). Don't collapse them back
  together: existing medication reminders still store, display and edit as
  medications, and only the picker changed.
- The API consumes the built `dist/`, so after editing run a build (the dev
  orchestrator and `npm run dev` rebuild it; `npm run typecheck` builds it too).
- Export everything through `src/index.ts`.
