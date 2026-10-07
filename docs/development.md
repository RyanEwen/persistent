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
  a WebView2 flyout and adds session-bound persistent notifications and alarm
  audio while the PC is awake and the process is running. See
  `docs/desktop-architecture.md`.
- **`packages/shared`** — Zod schemas + inferred types shared by API and web.

## The persistence reality

Truly undismissable notifications and repeating alarm sound while the app is
closed are native-OS capabilities, not web/PWA ones. So:

- The **web/PWA** is the management surface and does not send notifications.
- The **Windows native app** persistently alerts while its tray process and the PC
  are awake, but cannot guarantee delivery through sleep or shutdown.
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
**queue while offline**, replaying after account confirmation on reconnect, with **last-edit-wins**
conflict resolution. Live updates arrive over a per-user WebSocket. The native
client also pulls occurrences to schedule on-device alarms and drains
acks/snoozes back to the server. First opening and foregrounding wait behind a
spinner for fresh data. A previously signed-in account can reopen saved personal
data offline for up to seven days, with a visible offline status. New offline
reminders reach the native alarm scheduler after server sync. See
`docs/data-event-contract.md`.

## Development

The editor stays on the host. Devkit runs Node 20, PostgreSQL, and the Android
SDK/JDK in a checkout-specific Compose stack and injects `DATABASE_URL` and
`API_PORT` into the development processes.

```bash
nvm install        # installs the exact Node release from .nvmrc
nvm use
npm install
npm run dev        # shared (watch) + api + web, concurrently
npm run db:migrate # apply Prisma migrations
npm run validate   # lint + test + typecheck + prisma validate
```

`npm run dev` waits for PostgreSQL and applies all checked-in Prisma migrations
before it starts the watchers. Schema changes still need a real migration from
`npm run db:migrate -- <name>`; startup never substitutes `db push` for migration
history.

`validate` does not cover the native Kotlin. After editing `apps/mobile/android-plugin/`,
compile-check it with `npm run verify:android` (from `apps/mobile`) — see
`apps/mobile/README.md`.

For a paired physical phone, the root `android:*` npm commands cover wireless
pairing, rotating-port discovery, direct-debug assembly, installation, launch,
and focused logcat output. `npm run android:test-device -- <phone-ip>` runs the
normal device smoke-test sequence. Pairing codes are transient and must not be
stored in repository configuration. Android builds use no persistent Gradle
daemon and at most two workers by default to keep WSL responsive; set
`ANDROID_GRADLE_WORKERS` only when the host has known spare capacity.

The `$test-android-device` Codex skill follows that same physical-device
workflow. The repository-local Codex hook rejects patches to generated files
and to `apps/mobile/android/`; change the tracked native overlay or setup script
and regenerate instead.

`validate` does not cover the Windows desktop app either. From WSL,
`npm run verify:desktop` uses the shared build bridge for a full Windows Debug
compile, including XAML. `npm run build:desktop` builds a signed dev MSIX and
`npm run install:desktop` updates it in place and launches it in the signed-in
Windows session. Builds use a disposable C: TEMP copy of the working tree;
tracked release versions stay unchanged. Read
[the desktop workflow](../.codex/docs/windows-development.md) for prerequisites,
container delegation and package reuse. CI still compiles both architectures.

Compilation does not establish startup, packaging or UI behavior. Before committing
packaging or desktop runtime changes, install the working tree and check the changed
behavior. `npm run verify:desktop:csharp` retains the additional Linux non-XAML
compile check; it excludes generated XAML code and packaging.

Local auth works without mail infra: `DEMO_MODE=true` returns the sign-in code in
the API response instead of emailing it. Config lives in `.env` (see
`.env.example`).

For the Android app (build, wireless adb, signing), see `apps/mobile/README.md`.

### Multi-checkout development

`@ryanewen/devkit` 0.13.0 lets several repositories or linked worktrees run together
while the editor remains on the host. Each checkout gets a hostname and a private
Compose stack containing Node and PostgreSQL. Container ports stay fixed; the
published web port is derived from the checkout path.

```bash
npm run dev:bootstrap          # once per machine
npm run dev:prepare-worktree   # prepare this checkout without starting Docker
npm run dev:host -- snapshot   # once in the primary checkout, capture its database baseline
npm run dev
```

On first start, a worktree copies the primary checkout's `.env` only when it has none, replaces a
missing or shared dependency tree with a checkout-local `npm ci`, restores the portable database
baseline, applies migrations added by its branch, and prints both its proxied `*.localhost` URL and
direct Vite URL. A standalone clone still needs an initial `npm install` to install Devkit itself.
Persistent has no filesystem baseline paths, so snapshots contain database state only.

`npm run dev:prepare-worktree` copies missing allowlisted local configuration,
ensures checkout-local dependencies, generates the Prisma client, and builds the
shared contracts. It is safe to repeat and does not start Docker, PostgreSQL,
the proxy, or the app. Before a fresh checkout has dependencies, it uses the
`devkit` PATH link installed by the machine bootstrap. A standalone clone without
that link needs an initial `npm install`.

Starting development leaves the browser closed by default. Use
`npm run dev -- --open`, `--open=native`, or `--open=vscode` to opt in. Devkit
checks API readiness before an explicitly requested browser opening.

Only one dev runner can own a checkout. To detach it from the terminal, use
`npm run dev:background`; Devkit reports the runner PID and its log path.
That confirms preflight, not application readiness. `npm run dev:down` stops
the runner and tears down its checkout stack. Other checkouts run independently.

The snapshot, rather than `db:seed`, supplies a new worktree's initial users and
reminders. `npm run db:seed` remains an explicit operation against the current
checkout's database. Seed changes do not refresh the baseline automatically;
run `npm run dev:host -- snapshot` in the primary checkout when those changes
should reach future worktrees.

Passkeys are deliberately hostname-specific. A credential registered for
`localhost` cannot authenticate at `persistent.localhost`, and a credential for
one worktree hostname cannot authenticate at another. Cloning its database row
does not change that browser/WebAuthn binding, so use email-code sign-in and
register a passkey separately on each hostname where one is useful.

| Command | Purpose |
| --- | --- |
| `npm run dev:prepare-worktree` | Prepare configuration, dependencies, Prisma and shared contracts without starting infrastructure |
| `npm run dev:background` | Start the development runner detached from its terminal |
| `npm run dev:down` | Stop this checkout's development runner and containers, preserving its database volume |
| `npm run dev:doctor` | Report every development prerequisite and its fix |
| `npm run dev:host -- snapshot` | Refresh the portable database baseline for new worktrees |
| `npm run dev:host -- reset` | Recreate a worktree database volume; add `--empty` to skip the baseline |
| `npm run dev:host -- prune` | Find volumes for deleted worktrees; add `--yes` to remove them |
| `npm run dev:host -- infra` | Restart the machine proxy and this checkout's PostgreSQL container |

`npm run dev:down` removes this checkout's containers and network while preserving its
database volume.

Reset refuses to operate on the primary checkout because it owns the source
database for snapshots.

### Paseo workspace scripts

`paseo.json` uses the same setup and teardown commands for worktree lifecycle
hooks. Paseo prepares a new worktree with `npm run dev:prepare-worktree` and
runs `npm run dev:down` before removing it. Setup does not start the application;
run the `dev` script when you want to use it.

The Scripts menu exposes `dev-prepare-worktree`, `dev`, `dev-background`,
`dev-down`, `dev-doctor`, `validate`, `test`, and `build`. Prefer the supervised
foreground `dev` script when using Paseo's Start/Stop controls. The background
variant stays detached; stop it with `dev-down`.

Devkit owns checkout ports and proxy URLs, so these scripts do not ask Paseo to
allocate a second service port. The runner prints the proxied and direct URLs.
`build` compiles the application; `validate` checks it. Neither deploys it.
Resetting databases, refreshing snapshots, pruning volumes, bootstrapping the
machine, and deploying remain explicit operations outside automatic hooks.

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
baked-in copy, embedding secrets (DB password, Cloudflare
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
bundle, builds the signed Play AAB, generates changelog notes from the commits
since the previous tag, and ships one Android identity through both channels:

- **Play AAB to Google Play production.** Requires `PLAY_SERVICE_ACCOUNT_JSON`.
  Active phone testing releases are cleared in the same edit. Pre-flight rejects
  reused versionCodes before building; see `apps/mobile/store/play-readiness.md`.
- **Google-signed Play APK to GitHub Release.** After Play generates a universal
  APK, CI downloads it and verifies its package, version and registered Play
  signing certificate before publishing `persistent-X.Y.Z-play.apk`. There is
  no direct-APK fallback. Users can update through Google Play or manually install
  newer GitHub APKs; using the Store is optional.
- **Legacy direct installs:** a one-time opening notice and Settings guidance
  explain why the new APK installs separately and the loss of Android Auto.
  Both GitHub downloads and Google Play are offered as equal options. The old updater
  endpoint returns `null` to prevent incompatible install offers. Existing saved
  reminders are available after signing into the same account.
- **Existing uploads:** the manual `play-promote` workflow moves an uploaded
  versionCode to production without rebuilding and retires phone testing releases.
  It can also adjust a production rollout and refuses a downgrade.

Because the app loads the UI from production, web-only changes ship via a deploy
with no new build — cut a release only for native changes (alarm/update/passkey/
Google plugins, manifest, icon).

## Codex skills (`.agents/skills/`)

- `$commit`: review (docs, data isolation, and logging), validate, and commit.
- `$deploy`: `$commit`, then push and deploy through SSH and Docker.
- `$release`: derive the next version from changes since the last release, tag,
  and let CI publish the AAB to Google Play production and the verified
  Google-signed universal APK to GitHub.
- `$audit-docs`: resync all docs and project guidance with the code.
- `$verify`: observe web behavior or run the appropriate Android/desktop check.
- `$desktop`: build, verify or install the working tree through the shared Windows bridge.

## Docs

Cross-cutting contracts live in `docs/`: `auth-architecture.md`,
`data-event-contract.md`, `alarm-architecture.md`. Directory-scoped conventions
are in the scoped `AGENTS.md` files. Reusable workflows and focused agent guides
live under `.agents/`.
