# Persistent

A reminder/notification app whose defining feature is **persistence**: a reminder
keeps nagging — a notification that won't dismiss, re-fires after dismissal, and
can play sound on an interval — until you *explicitly confirm completion*. Built
for medication reminders, todos, and anything you must not forget, with optional
**escalation** of ignored reminders (your own devices + an email contact).

It runs as a hosted web service (public sign-ups, any device) and syncs to a
native Android client (Capacitor) where the hard alarm guarantees actually live.

> Architecture and conventions are borrowed, thinned, from the sibling
> `printstream` monorepo. See `docs/` and `.claude/guides/`.

## Stack

- **`apps/api`** — Express + Prisma + PostgreSQL + WebSocket + the scheduling/
  escalation engine.
- **`apps/web`** — Vite + React + Joy UI PWA (the single UI codebase).
- **`apps/mobile`** — Capacitor (Android) wrapper of the web build + a custom
  native alarm plugin (foreground service + exact alarms + full-screen + looping
  sound). *(Phase 4.)*
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

## Development (devcontainer-only)

This project is developed exclusively inside its **dev container** (VS Code:
"Reopen in Container"). The container provides Node 20, PostgreSQL (`db`
service), and all tooling; `DATABASE_URL`/`API_PORT` are injected automatically.

```bash
npm run dev        # shared (watch) + api + web, concurrently
npm run db:migrate # apply Prisma migrations
npm run validate   # lint + test + typecheck + prisma validate
```

Local auth works without mail infra: `DEMO_MODE=true` returns the sign-in code in
the API response instead of emailing it.

## Deployment

Production runs a single Docker image (built from `Dockerfile`) that serves the
API and the built web app on one origin, plus Postgres — see `compose.server.yml`.
The server holds a git checkout and a filled-in `.env.server` (`.env.server.example`)
behind a TLS reverse proxy. Deploy from a clean, pushed tree with:

```bash
npm run deploy:prod            # SSH + docker compose up --build; migrations run on start
npm run deploy:prod -- --dry-run
```

Deploy target comes from your local `.env` (`DEPLOY_SSH_HOST`, `DEPLOY_REPO_PATH`,
`DEPLOY_BRANCH`). The `/deploy` slash command wraps review + commit + push + deploy.

## License

UNLICENSED — private.
