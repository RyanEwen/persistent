---
description: "Stage, review, and commit the current changes with mandatory documentation, data-isolation, and logging-coverage reviews."
argument-hint: "[message hint or summary] [push]"
---

Commit the current changes to git.

Invocation input (optional): $ARGUMENTS

Requirements:
- Review both staged and unstaged changes before deciding on the final commit scope.
- If there are no staged or unstaged changes, inform the user and exit without committing.
- Stage only changes that belong in the commit. Never stage generated or secret files — `dist/`, `**/node_modules/`, `.env*`, `apps/mobile/android/`, `apps/web/dist/`, coverage. If such files appear in the diff, fix `.gitignore` instead of staging them.
- Perform a mandatory, exhaustive documentation review before committing (see below). Treat doc drift as a defect that blocks the commit: update what's stale.
- Perform a mandatory data-isolation review before committing (see below).
- Perform a mandatory logging-coverage review before committing (see below).
- Draft the commit message before running `git commit`.
- Do not ask for confirmation before committing unless the invocation explicitly requests a pause.
- Treat an explicit `push` request as approval to run `git push` after a successful commit. Otherwise ask before pushing.

Documentation review scope — this is MANDATORY and EXHAUSTIVE. For every change in
the commit, open the docs that describe the touched area and reconcile them; do
not gate this on whether the change "feels user-visible". Drift is a bug. Review
**all documentation surfaces** and update any that no longer match the code:

- `README.md` (root) — stack, features, auth, sync model, dev/deploy workflow,
  releases, the slash-command list.
- `apps/mobile/README.md` — the Android build/run/sign/update flow and native plugins.
- Every `CLAUDE.md`: root plus the directory guides `apps/api/CLAUDE.md`,
  `apps/web/CLAUDE.md`, `packages/shared/CLAUDE.md` — conventions, model lists,
  helper inventories, and "do/don't" rules that the change affects.
- `docs/` contracts — `auth-architecture.md`, `data-event-contract.md`,
  `alarm-architecture.md` — whenever auth/sessions/passkeys, the HTTP/WS data
  flow + offline sync, or the notification/alarm/escalation model changed.
- `.claude/commands/` (`commit.md`, `deploy.md`, `release.md`, `audit-docs.md`) —
  when a workflow, script, or expectation referenced by a command changed.
- `.env.example` — when any env var / config key is added, renamed, or removed.
- Build/deploy descriptors — `Dockerfile`, `compose.server.yml`,
  `.github/workflows/*`, root/workspace `package.json` scripts — keep referenced
  commands and behavior accurate.
- In-code docs — the JSDoc header / comments of each non-trivial module you
  changed (it must still name what the module owns and any invariants), and any
  inline comment that the change invalidates.

In the commit summary, state explicitly which doc surfaces you reviewed and which
you updated; if a surface needed no change, say so. "I didn't check docs" or
silently skipping a surface is not acceptable.

Data-isolation review scope (the one rule — see `docs/auth-architecture.md`):
- Every new or changed query that reads/writes a domain row (`Reminder`, `ReminderOccurrence`, `PushSubscription`, `Device`) MUST filter by the authenticated `userId` (`requireUserId(request)`). Edit/delete must first re-fetch `{ id, userId }` and 404 if missing — never trust a path id alone.
- `Setting` is the only intentionally global model; flag any other unscoped domain access.
- New request bodies must be validated at the boundary with a Zod schema from `@persistent/shared`.

Logging-coverage review scope (operational logs go through `apps/api/src/lib/logger.ts`):
- New or changed FAILURE paths must be observable: log via `logger.warn`/`logger.error` rather than silently swallowing. Empty `catch {}` / `.catch(() => …)` that drop a real error (scheduler loops, push delivery, email, the WS hub) are gaps — keep a swallow only when genuinely benign, and say why.
- Use the right level (failures at `warn`/`error`, not `info`); avoid per-iteration logging in the scheduler tick/sweep hot paths.
- NEVER log a secret: session secrets, sign-in/email codes, the VAPID private key, push endpoints/FCM tokens, or raw request bodies. Log only error messages and safe identifiers (userId, reminderId, occurrenceId, status codes).

Recommended steps:
1. `git diff --stat` and `git diff --cached --stat`.
2. Inspect changed files and stage only the intended scope with selective `git add <path>`, or `git add -A` then `git reset <path>` for anything that must stay unstaged.
3. Run the documentation, data-isolation, and logging reviews above. For docs, walk every surface in the (exhaustive) Documentation review scope, update what drifted, and report per-surface what you reviewed/updated (or why none was needed) — never skip a surface silently.
4. Draft a commit message in imperative mood with a short subject; add a short body if the change is non-trivial.
5. Run `npm run validate` and fix any failures before committing.
6. Run `git commit`. Do NOT add any `Co-Authored-By` trailer or other AI/agent attribution to the message.
7. If the invocation asked for `push`, run `git push`.

Notes:
- Development is devcontainer-only; `npm run validate` expects the `db` service + injected `DATABASE_URL`.
- If `git commit` fails due to a hook, merge conflict, or dirty-state problem, report the error and suggest resolution rather than retrying blindly.
- Treat phrases like `confirm first`, `review before commit`, or `show me the message first` as explicit pause requests.
