---
name: audit-docs
description: "Audit Persistent documentation and Codex guidance against the current codebase and workflow."
---

Audit the repository documentation and bring it back in sync with the current codebase.

Invocation input (optional): the user-provided scope or recent change summary.

Requirements:
- Focus on accuracy, not churn.
- If a scope or recent change summary is provided, narrow the audit to the affected files and their related documentation. If omitted, audit all listed files.
- Update only docs and customization files that are stale, incomplete, or misleading.
- Verify behavior from source files before editing documentation.
- Keep `AGENTS.md` files, `.agents/`, and `docs/` coherent with the repository workflow.

Audit scope:
- `README.md`
- Every tracked `AGENTS.md` (enumerate with `git ls-files '*AGENTS.md'`)
- `.agents/guides/` and `.agents/skills/`
- `docs/auth-architecture.md`, `docs/data-event-contract.md`, `docs/alarm-architecture.md`,
  `docs/notification-behavior.md`, `docs/desktop-architecture.md`, `docs/development.md`
- Shared contract guidance implied by `packages/shared`, `apps/api`, and `apps/web`
- `apps/mobile/README.md` when the native client or alarm plugin changed

Recommended steps:
1. Review the active change scope with `git status --short`, `git diff --stat`, and `git diff --cached --stat`.
2. Read the affected source files before editing docs.
3. Update high-level docs when setup, architecture, contracts, or workflow changed.
4. Update `AGENTS.md` and `.agents/guides/` when conventions or invariants drift.
5. Update skills when their workflow expectations change.
6. Make sure root `AGENTS.md` still routes to the right scoped guidance.
7. Summarize what changed, what stayed correct, and any remaining documentation gaps.

Notes:
- The persistence/alarm model is the project's defining contract. Keep
  `docs/alarm-architecture.md`, `docs/notification-behavior.md`, and
  `.agents/guides/reminder-model.md` aligned.
- Do not rewrite accurate sections just for style consistency.
- When the code and docs disagree, verify the code before choosing the final wording.
- If a listed file does not exist, skip it and note its absence. If it should exist based on the codebase, recommend creating it.
