---
name: deploy
description: "Review, document, commit, push, and deploy Persistent through its SSH and Docker production workflow."
---

# Deploying Persistent

Commit, push, and deploy the current changes.

Invocation input (optional): the user-provided change summary, pause request,
dry-run request, or deploy arguments.

## Requirements

- Read and follow `../commit/SKILL.md` for staging, documentation,
  data-isolation, logging, validation, and commit requirements.
- A deploy request authorizes the required commit, push, and deployment unless
  the invocation explicitly asks for a pause, review-only pass, or dry run.
- Use `npm run deploy:prod` by default. Pass through explicit options such as
  `--dry-run`, `--host`, `--repo-path`, `--branch`, or `--skip-validate`.
- The deploy script requires a clean tree and local `HEAD` equal to
  `origin/<branch>`. Do not work around either guard.
- If commit, push, or deploy fails, report the full error and stop instead of
  retrying blindly.

## Workflow

1. Review staged and unstaged changes, then follow the commit skill through a
   successful `npm run validate` and commit. If the invocation requests a
   pause, show the proposed commit and deploy commands and stop before mutation.
2. Push the commit. On a non-fast-forward failure, report it and suggest
   reconciling with `git pull --rebase`.
3. Run `npm run deploy:prod` with any explicit pass-through arguments.
4. Report the commit, exact push and deploy commands, and remote result.

## Production facts

- Target configuration comes from `.env`: `DEPLOY_SSH_HOST`,
  `DEPLOY_REPO_PATH`, and `DEPLOY_BRANCH`.
- The server holds a checkout and filled-in `.env` next to
  `compose.server.yml`; the API binds to `127.0.0.1:4000` behind TLS.
- Prisma migrations run during `npm run start:prod`; there is no separate
  production migration step.
- Production data lives in the `persistent-data` Docker volume. Never destroy
  it without explicit confirmation.
