# Development

Developer setup, architecture, and release/deploy workflow for Persistent. (User-
facing overview is in the root `README.md`.)

## Stack

- **`apps/api`** — Express + Prisma + PostgreSQL + WebSocket + the scheduling/
  escalation engine.
- **`apps/web`** — Vite + React + Joy UI PWA (the single UI codebase).
- **`apps/mobile`** — Capacitor (Android) wrapper that loads the web UI and adds
  the native plugins: a custom alarm plugin (foreground service + exact alarms +
  full-screen + looping sound), an in-app updater, a passkey/Credential Manager
  bridge, and Google sign-in. See `apps/mobile/README.md`.
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

Passwordless: a one-time **email code**, a **passkey**, or **Sign in with
Google** (when `GOOGLE_WEB_CLIENT_ID` is configured). All resolve to the same
account by email. See `docs/auth-architecture.md`.

## Sync model

The server owns the truth; clients hold a mirror. Reads go over HTTP (TanStack
Query, cache persisted for offline reads); writes apply optimistically and
**queue while offline**, replaying on reconnect, with **last-edit-wins**
conflict resolution. Live updates arrive over a per-user WebSocket. The native
client also pulls occurrences to schedule on-device alarms and drains
acks/snoozes back to the server. See `docs/data-event-contract.md`.

## Development (devcontainer-only)

Developed exclusively inside the **dev container** (VS Code: "Reopen in
Container"), which provides Node 20, PostgreSQL (`db` service), the Android
SDK/JDK, and all tooling; `DATABASE_URL`/`API_PORT` are injected automatically.

```bash
npm run dev        # shared (watch) + api + web, concurrently
npm run db:migrate # apply Prisma migrations
npm run validate   # lint + test + typecheck + prisma validate
```

Local auth works without mail infra: `DEMO_MODE=true` returns the sign-in code in
the API response instead of emailing it. Config lives in `.env` (see
`.env.example`).

For the Android app (build, wireless adb, signing), see `apps/mobile/README.md`.

## Deployment

Production runs a single Docker image (built from `Dockerfile`) that serves the
API and the built web app on one origin, plus Postgres — see `compose.server.yml`.
The server holds a git checkout and a filled-in `.env` behind a TLS reverse
proxy. Deploy from a clean, pushed tree with:

```bash
npm run deploy:prod            # SSH + docker compose up --build; migrations run on start
npm run deploy:prod -- --dry-run
```

Deploy target comes from your local `.env` (`DEPLOY_SSH_HOST`, `DEPLOY_REPO_PATH`,
`DEPLOY_BRANCH`).

## Releases & updates

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which builds the web
bundle, assembles a **signed** APK, generates changelog notes from the commits
since the previous tag, and publishes a GitHub Release (APK + notes). The app
checks GitHub on launch (and from Settings → About) and offers an in-app
download/install of a newer APK. Because the APK loads the UI from production,
web-only changes ship via a deploy with no new APK — release a new APK only for
native changes (alarm/update/passkey/Google plugins, manifest, icon).

## Slash commands (`.claude/commands/`)

- `/commit` — review (docs + data-isolation + logging) + validate + commit.
- `/deploy` — `/commit` then push + SSH-Docker deploy.
- `/release` — derive the next version from changes since the last release, tag,
  and let CI build the signed APK + GitHub Release.
- `/audit-docs` — resync all docs with the code.

## Docs

Cross-cutting contracts live in `docs/`: `auth-architecture.md`,
`data-event-contract.md`, `alarm-architecture.md`. Directory-scoped conventions
are in each `CLAUDE.md`.
