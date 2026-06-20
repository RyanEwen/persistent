---
description: "Review, document, commit, push, and deploy the current changes via the SSH-Docker production workflow unless the invocation requests a pause."
argument-hint: "[change summary | confirm first | dry run | alternate deploy args]"
---

Commit, push, and deploy the current changes.

Invocation input (optional): $ARGUMENTS

Requirements:
- Review both staged and unstaged changes before deciding on the final commit scope.
- Stage relevant tracked changes by default with `git add -A`, then unstage build output, secrets, or unrelated generated files (`dist/`, `**/node_modules/`, `.env*`, `apps/web/dist/`, `apps/mobile/android/`).
- Perform the mandatory documentation, data-isolation, and logging-coverage reviews from `/commit` before committing.
- Draft the commit message before running `git commit`.
- Do not ask for confirmation before committing unless the invocation explicitly requests a pause, review-only, or dry-run.
- Treat the invocation as approval to `git push` after a successful commit unless it says not to.
- Treat the invocation as approval to deploy after a successful push unless it says not to.
- Use the production deploy path by default: `npm run deploy:prod` (SSH + Docker Compose; see `scripts/deploy/deploy-over-ssh.mjs`).
- Pass through any explicit deploy args: `--dry-run`, `--host`, `--repo-path`, `--branch`, `--skip-validate`.

Reviews before committing: run the documentation, data-isolation, and logging-coverage reviews exactly as defined in `.claude/commands/commit.md`. (There is no open-core/export step in this project.)

Recommended steps:
1. `git diff --stat` and `git diff --cached --stat`.
2. Inspect changed files; stage the intended set and unstage anything generated/secret.
3. Run the documentation + data-isolation + logging reviews; update what's stale. Explicitly confirm when nothing needs changing.
4. Run `npm run validate`; fix failures before continuing.
5. Draft a commit message (imperative subject; short body if non-trivial); end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
6. If the invocation requested a pause/review/dry-run-only, show the message and stop before `git commit`.
7. Otherwise show the message and run `git commit`. If it fails, report the full error and stop.
8. Run `git push` unless disabled. If it fails, suggest `git pull --rebase` before retrying.
9. Run `npm run deploy:prod` (with any pass-through args) unless deployment is disabled. The script refuses to deploy if the local tree is dirty or local `HEAD` != `origin/<branch>`, and runs `npm run validate` first unless `--skip-validate`.
10. Summarize the exact push + deploy commands used and any errors.

Notes:
- Deploy target comes from `.env` (`DEPLOY_SSH_HOST`, `DEPLOY_REPO_PATH`, `DEPLOY_BRANCH`); the server holds a filled-in `.env.server` next to `compose.server.yml`.
- Production data lives in the `persistent-data` Docker volume on the server. Never destroy it without explicit user confirmation.
- Prisma migrations run automatically on container start (`npm run start:prod`); no separate migrate step.
- The API serves the built web app on the same origin behind your TLS reverse proxy (the container binds `127.0.0.1:4000`).
- If the deploy fails, show the full output, do not retry blindly, and check SSH connectivity + that local `HEAD` matches `origin/<branch>`.
- Treat phrases like `confirm first`, `show me the message first`, or `dry run only` as explicit pause requests for the step they reference.
