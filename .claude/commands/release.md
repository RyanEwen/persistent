---
description: "Cut a new release: derive the next version from changes since the last release, bump it, tag, and let CI build the signed APK + GitHub Release."
argument-hint: "[major|minor|patch to force a bump | confirm first | dry run]"
---

Cut a new app release.

Invocation input (optional): $ARGUMENTS

The release pipeline is `.github/workflows/release.yml`: pushing a `vX.Y.Z` tag
builds the web bundle, assembles a **signed** APK, generates changelog notes from
the commits since the previous tag (filtered to end-user-facing changes only —
internal/docs/tooling commits are excluded; see the `EXCLUDE` list in the
workflow), and publishes a GitHub Release (APK + notes). The app surfaces those
notes in the in-app update prompt. This command decides the
next version, records it, and pushes the tag.

Requirements:
- The working tree must be clean and `HEAD` must equal `origin/<default branch>`
  before tagging (commit/push first — chain `/commit` or `/deploy` if there are
  pending changes). If it isn't, stop and say so.
- Determine the **last release version** from `gh release list` (newest `vX.Y.Z`),
  falling back to the latest `git tag -l 'v*'`. If there are no releases yet,
  start from the current `apps/web/package.json` version.
- Derive the **next version** from the commits since that tag
  (`git log <lastTag>..HEAD --pretty=%s%n%b`), unless the invocation forces a
  level (`major` / `minor` / `patch`):
  - **major** if any commit indicates a breaking change (`BREAKING CHANGE`, or a
    `type!:` subject).
  - else **minor** if any commit adds functionality (subject starts with `feat`,
    `Add`, `add`, or clearly introduces a feature).
  - else **patch** (fixes, refactors, docs, chore, UI tweaks).
  Increment from the last release version accordingly (e.g. patch: `0.1.3 → 0.1.4`,
  minor: `0.1.3 → 0.2.0`, major: `0.1.3 → 1.0.0`).
- Keep `apps/web/package.json` `version` in sync: set it to the new version
  (this is the in-app displayed version / web build version). The APK's
  versionName comes from the tag in CI; versionCode from the run number.
- Do NOT invent a version when uncertain — show the computed bump and the commit
  summary it's based on; if the invocation says `confirm first` or `dry run`,
  stop after showing the plan (don't tag).

Recommended steps:
1. `gh release list --limit 5` (and `git tag -l 'v*' --sort=-v:refname | head`)
   to find the last release version.
2. `git log <lastTag>..HEAD --pretty=format:'%s'` to list the changes; classify
   the bump (or honor a forced level from the invocation).
3. Compute the next `vX.Y.Z`. Summarize: last version, new version, the bump
   level, and the notable commits driving it.
4. If `confirm first` / `dry run`: print the summary and stop.
5. Otherwise bump `apps/web/package.json` to the new version and commit it
   (`Bump version to X.Y.Z`; no `Co-Authored-By` trailer or AI attribution).
   Run `npm run validate` first; fix failures before continuing.
6. `git push`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
7. Watch the workflow: `gh run watch <id> --exit-status` (find it via
   `gh run list --workflow=release.yml --limit 1`). Confirm the release published
   with the APK asset (`gh release view vX.Y.Z`).
8. Report the new version, the bump reasoning, and the release URL.

Notes:
- Web/server changes reach devices via the prod deploy (`/deploy`); a release
  (new APK) is only required for native changes (alarm/update plugins, manifest,
  icon) — but cutting one also refreshes the bundled web fallback. Mention if the
  release wasn't strictly necessary.
- The signing key + `ANDROID_*` secrets already exist in the repo's Actions
  secrets; the same keystore must be used every release or updates won't install
  over each other.
- Never tag a version older than or equal to the last release.
