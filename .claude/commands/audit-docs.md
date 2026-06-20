---
description: "Audit repository documentation and Claude customization files so they match the current codebase and workflow."
argument-hint: "[scope or recent change summary]"
---

Audit the repository documentation and bring it back in sync with the current codebase.

Scope hint (optional): $ARGUMENTS

Requirements:
- Focus on accuracy, not churn.
- If a scope or recent change summary is provided, narrow the audit to the affected files and their related documentation. If omitted, audit all listed files.
- Update only docs and customization files that are stale, incomplete, or misleading.
- Verify behavior from source files before editing documentation.
- Keep the `CLAUDE.md` files, `docs/`, and `.claude/commands/` coherent with the actual repository workflow.

Audit scope:
- `README.md`
- Root `CLAUDE.md` and the nested guides (`apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `packages/shared/CLAUDE.md`)
- `docs/auth-architecture.md`, `docs/data-event-contract.md`, `docs/alarm-architecture.md`
- `.claude/commands/`
- Shared contract guidance implied by `packages/shared`, `apps/api`, and `apps/web`
- `apps/mobile/README.md` when the native client or alarm plugin changed

Recommended steps:
1. Review the active change scope with `git status --short`, `git diff --stat`, and `git diff --cached --stat`.
2. Read the affected source files before editing docs.
3. Update high-level docs when setup, architecture, contracts, or workflow changed.
4. Update the `CLAUDE.md` files when file coverage, conventions, or the data-isolation/alarm invariants drifted.
5. Update command files when the expected workflow changed.
6. Make sure the root `CLAUDE.md` "How guidance is organized" index still points at the right docs.
7. Summarize what changed, what stayed correct, and any remaining documentation gaps.

Notes:
- The persistence/alarm model is the project's defining contract — keep `docs/alarm-architecture.md` and the root `CLAUDE.md` "persistence reality" section authoritative and aligned.
- Do not rewrite accurate sections just for style consistency.
- When the code and docs disagree, verify the code before choosing the final wording.
- If a listed file does not exist, skip it and note its absence. If it should exist based on the codebase, recommend creating it.
