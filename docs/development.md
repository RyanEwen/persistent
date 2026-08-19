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
- **`apps/desktop`** — WinUI 3 (C#) Windows tray app. Hosts the *hosted* web UI in
  a WebView2 flyout; it shows and confirms reminders but deliberately never rings.
  See `docs/desktop-architecture.md`.
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

`validate` does not cover the native Kotlin. After editing `apps/mobile/android-plugin/`,
compile-check it with `npm run verify:android` (from `apps/mobile`) — see
`apps/mobile/README.md`.

It doesn't cover `apps/desktop` (C#) either, and the app can't be *built* here:
the Windows App SDK's XAML compiler and `MakePri.exe` are Windows-only binaries,
so the build dies before it reaches any C#. Its only complete check is
`.github/workflows/build-desktop-msix.yml`, which compiles both platforms on
`windows-2025` for every push/PR touching that directory; treat a red run there as
a failed validate.

The image does ship the .NET SDK, so `npm run verify:desktop` compiles the
**non-XAML** C# against the real Windows App SDK reference assemblies. Run it
before pushing desktop changes: it catches a misremembered WinRT API in seconds
instead of a CI round-trip. It checks no XAML, no `.xaml.cs` and no packaging, so
green there is necessary and never sufficient. See `docs/desktop-architecture.md`.

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

### How production config reaches the container

The server's `.env` is **not** copied into the image — `.dockerignore` excludes it,
because `lib/env.ts` does `import 'dotenv/config'` and would otherwise read a
baked-in copy, embedding secrets (DB password, VAPID private key, Cloudflare
token) in a distributable layer and hiding the container's real configuration from
`docker inspect`.

Instead the host `.env` is used by compose for **substitution**, and
`compose.server.yml` enumerates what the api service actually receives. That means
**adding a variable to the schema is not enough** — a key read by
`apps/api/src/lib/env.ts` but absent from that `environment:` block is silently
`undefined` in production, which just looks like a disabled feature.
`apps/api/src/lib/env.test.ts` enforces the invariant: every schema key must be
declared in `compose.server.yml` or as a `Dockerfile ENV`.

So to add config: schema in `env.ts` → `environment:` in `compose.server.yml` →
value in the server's `.env` → redeploy.

## Releases & updates

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which builds the web
bundle, assembles **both signed Android flavors**, generates changelog notes from
the commits since the previous tag, and ships each to its channel:

- **`direct` APK → GitHub Release.** The app checks GitHub on launch (and from
  Settings → About) and offers an in-app download/install of a newer APK.
- **`play` AAB → Google Play**, released to the **`internal` and `alpha`** tracks
  from one upload, reusing the same notes truncated to Play's 500-character limit.
  Skipped unless the `PLAY_SERVICE_ACCOUNT_JSON` secret is set, so tagging behaves
  identically on forks. A pre-flight runs before the Android build and fails fast
  on a `versionCode` that Play already has. Publishing internals are in
  `apps/mobile/scripts/play-publish.mjs`; Console setup is in
  `apps/mobile/store/play-readiness.md` §6b.
- **Reaching `beta` or `production`** is never part of a tag. It is the manual
  `play-promote` workflow, which moves a versionCode already on Play onto another
  track with no rebuild and no re-upload, so what ships is byte-for-byte what was
  tested. It can stage the rollout to a fraction of users, and it refuses both a
  code that is on no track and one older than the destination already serves.

Because the app loads the UI from production, web-only changes ship via a deploy
with no new build — cut a release only for native changes (alarm/update/passkey/
Google plugins, manifest, icon).

## Slash commands (`.claude/commands/`)

- `/commit` — review (docs + data-isolation + logging) + validate + commit.
- `/deploy` — `/commit` then push + SSH-Docker deploy.
- `/release` — derive the next version from changes since the last release, tag,
  and let CI build both flavors: the signed APK onto a GitHub Release and the
  AAB onto Google Play's `internal` + `alpha` tracks.
- `/audit-docs` — resync all docs with the code.

## Docs

Cross-cutting contracts live in `docs/`: `auth-architecture.md`,
`data-event-contract.md`, `alarm-architecture.md`. Directory-scoped conventions
are in each `CLAUDE.md`.
