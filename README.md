# Persistent

A reminder/notification app whose defining feature is **persistence**: a reminder
keeps nagging — a notification that won't dismiss, re-fires after dismissal, and
can play sound on an interval — until you *explicitly confirm completion*. Built
for medication reminders, todos, and anything you must not forget, with optional
**escalation**: if an ignored reminder isn't acknowledged in time it rings a
full alarm on your own devices (and can optionally email a contact with a custom
message). Escalation is a hard backstop — anchored to the first fire, so snoozing
can't push it past the deadline. (Alarm-type reminders already ring continuously,
so escalation doesn't apply to them.)

It runs as a hosted web service (public sign-ups, any device) and syncs to a
native Android client (Capacitor) where the hard alarm guarantees actually live.

> Architecture and conventions are borrowed, thinned, from the sibling
> `printstream` monorepo. Cross-cutting contracts live in `docs/`; repeatable
> workflows are `.claude/commands/` slash commands.

## Stack

- **`apps/api`** — Express + Prisma + PostgreSQL + WebSocket + the scheduling/
  escalation engine.
- **`apps/web`** — Vite + React + Joy UI PWA (the single UI codebase).
- **`apps/mobile`** — Capacitor (Android) wrapper that loads the web UI and adds
  the native plugins: a custom alarm plugin (foreground service + exact alarms +
  full-screen + looping sound), an in-app updater, and a passkey/Credential
  Manager bridge. See `apps/mobile/README.md`.
- **`packages/shared`** — Zod schemas + inferred types shared by API and web.

## The persistence reality

Truly undismissable notifications and repeating alarm sound while the app is
closed are native-OS capabilities, not web/PWA ones. So:

- The **web/PWA** is the management surface + best-effort reminders (re-fire on
  close, `requireInteraction` on desktop).
- The **Android native app** is where the real guarantee lives.

Reminders fire reliably even offline via **device-scheduled local alarms** synced
from the server (the source of truth); server push is the cross-device /
escalation / ad-hoc backup. See `docs/alarm-architecture.md`.

## Auth

Passwordless: request a one-time **email code** (sign-up and sign-in are the same
flow), or register a **passkey** and sign in with a single biometric/PIN gesture.
Sessions are a sliding 7-day window (any in-app action or notification
ack/snooze/sync extends them). See `docs/auth-architecture.md`.

## Sync model

The server owns the truth; clients hold a mirror. Reminder reads/writes go over
HTTP (TanStack Query, cache persisted for offline reads); writes apply
optimistically and **queue while offline**, replaying on reconnect. Conflicts
resolve **last-edit-wins** (each edit carries its client timestamp). Live updates
arrive over a per-user WebSocket and invalidate caches. The native client also
pulls occurrences to schedule on-device alarms and drains acks/snoozes back to
the server. See `docs/data-event-contract.md`.

## Development (devcontainer-only)

This project is developed exclusively inside its **dev container** (VS Code:
"Reopen in Container"). The container provides Node 20, PostgreSQL (`db`
service), the Android SDK/JDK, and all tooling; `DATABASE_URL`/`API_PORT` are
injected automatically.

```bash
npm run dev        # shared (watch) + api + web, concurrently
npm run db:migrate # apply Prisma migrations
npm run validate   # lint + test + typecheck + prisma validate
```

Local auth works without mail infra: `DEMO_MODE=true` returns the sign-in code in
the API response instead of emailing it.

For the Android app (build, wireless adb, signing), see `apps/mobile/README.md`.

## Deployment

Production runs a single Docker image (built from `Dockerfile`) that serves the
API and the built web app on one origin, plus Postgres — see `compose.server.yml`.
The server holds a git checkout and a filled-in `.env` (`.env.example`)
behind a TLS reverse proxy. Deploy from a clean, pushed tree with:

```bash
npm run deploy:prod            # SSH + docker compose up --build; migrations run on start
npm run deploy:prod -- --dry-run
```

Deploy target comes from your local `.env` (`DEPLOY_SSH_HOST`, `DEPLOY_REPO_PATH`,
`DEPLOY_BRANCH`).

## Releases & updates

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which builds the web
bundle, assembles a **signed** APK, and publishes a GitHub Release with the APK
attached. The app checks GitHub on launch (and from Settings → About) and offers
an in-app download/install of a newer APK. Because the APK loads the UI from
production, web-only changes ship via a deploy with no new APK — release a new
APK only for native changes (alarm/update/passkey plugins, manifest, icon).

## Slash commands (`.claude/commands/`)

- `/commit` — review (docs + data-isolation + logging) + validate + commit.
- `/deploy` — `/commit` then push + SSH-Docker deploy.
- `/release` — derive the next version from changes since the last release, tag,
  and let CI build the signed APK + GitHub Release.
- `/audit-docs` — resync all docs with the code.

## License

UNLICENSED — private.
