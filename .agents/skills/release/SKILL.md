---
name: release
description: "Cut a new release: derive the next version from changes since the last release, bump it, tag, and let CI build the signed APK (GitHub Release) and the AAB (Google Play)."
---

Cut a new app release.

Invocation input (optional): the user-provided bump level, pause request, or dry-run request.

The release pipeline is `.github/workflows/release.yml`: pushing a `vX.Y.Z` tag
builds the web bundle, builds the signed Play AAB, generates
changelog notes from the commits since the previous tag (filtered to
end-user-facing changes only: internal/docs/tooling commits are excluded; see the
`EXCLUDE` list in the workflow), and publishes one Play identity through both channels:

- `play` -> **AAB** released to Google Play **production**, reusing the notes
  truncated to Play's 500-character limit. `PLAY_SERVICE_ACCOUNT_JSON` is required.
  Tags and manual releases have no tester-track destination. Active phone testing
  releases are retired in the same edit using `--production-only`.
- Google Play's **signed universal APK** -> GitHub Release, named
  `persistent-X.Y.Z-play.apk`, after verifying package, version and the registered
  Google certificate. No direct APK fallback is allowed. Append the required
  italicized AI disclosure to GitHub notes after deriving Play's notes.

Legacy direct installs have a different package and certificate and cannot update
in place. The hosted UI explains the separate installation and offers both manual
GitHub downloads and Google Play; using the Store is optional. The compatibility updater
endpoint returns `null`. Keep legacy passkey origins and asset links authorized.
The manual `replace-github-apk` workflow exports an existing Play versionCode,
preserves approved notes, and replaces the direct asset without uploading an AAB.

Production is open. The first production release was versionCode 47 (v0.23.0)
on 2026-09-05. Ryan changed the release policy to production-only on 2026-10-02.
An explicit request to cut a release authorizes its production publication.
The manual `play-promote` workflow is only for an existing uploaded versionCode
or a production rollout adjustment. It targets production, carries forward the
source notes and clears active phone testing releases without rebuilding.
If promotion is refused, the edit stays uncommitted and the publisher prints
the Console-side checklist. See `apps/mobile/store/play-readiness.md` #6b.

Never publish the `direct` APK to Play: it carries two things the `play` flavor
deliberately omits: the in-app updater with `REQUEST_INSTALL_PACKAGES`, which Play
prohibits, and the Android Auto car screen (`ReminderCarAppService`), which would draw
an Auto review against a category this app can't honestly claim. The workflow asserts
both are absent from the Play bundle before uploading ("Verify the Play bundle carries
no direct-only components"); see `apps/mobile/store/play-readiness.md` #1 and #1a.

This command decides the next version, records it, and pushes the tag.

Requirements:
- The working tree must be clean and `HEAD` must equal `origin/<default branch>`
  before tagging (commit and push first; use `$commit` or `$deploy` if there are
  pending changes). If it isn't, stop and say so.
- Determine the **last release version** from `gh release list` (newest `vX.Y.Z`),
  falling back to the latest `git tag -l 'v*'`. If there are no releases yet,
  start from the current `apps/web/package.json` version.
- **Gate the Android release before bumping anything.** Compare the last Android
  tag with `HEAD` for native Android runtime code, resources, plugins, manifest,
  or build configuration. Web and server changes delivered by `$deploy`, desktop
  changes, Store listing assets, documentation, and tooling do not justify an
  Android version. An APK would bundle a newer web fallback, but that alone is
  not a reason to release it. If there is no qualifying native change, stop
  without a version commit or tag and report that no Android release is needed.
  Only bypass this gate when the user explicitly requests a new Android binary
  for a concrete reason.
- Derive the **next version** from the commits since that tag
  (`git log <lastTag>..HEAD --pretty=%s%n%b`), unless the invocation forces a
  level (`major` / `minor` / `patch`):
  - **major** if any commit indicates a breaking change (`BREAKING CHANGE`, or a
    `type!:` subject).
  - else **minor** if any commit adds functionality (subject starts with `feat`,
    `Add`, `add`, or clearly introduces a feature).
  - else **patch** (fixes, refactors, docs, chore, UI tweaks).
  Increment from the last release version accordingly (e.g. patch: `0.1.3 -> 0.1.4`,
  minor: `0.1.3 -> 0.2.0`, major: `0.1.3 -> 1.0.0`).
- Keep `apps/web/package.json` `version` in sync: set it to the new version
  (this is the in-app displayed version / web build version). The APK's
  versionName comes from the tag in CI; versionCode from the run number plus the
  `PLAY_VERSION_CODE_OFFSET` repo variable (unset = 0).
- **Regenerate the lockfile after bumping**: `npm install --package-lock-only`.
  `package-lock.json` records each workspace's version, editing `package.json`
  alone leaves it stale, and `npm ci` then bakes the wrong version into the built
  image. `scripts/dev/workspace-versions.test.ts` fails the build if you forget,
  so `npm run validate` catches it, but do it as part of the bump commit.
- Do NOT invent a version when uncertain: show the computed bump and the commit
  summary it's based on; if the invocation says `confirm first` or `dry run`,
  stop after showing the plan (don't tag).

Recommended steps:
1. `gh release list --limit 5` (and `git tag -l 'v*' --sort=-v:refname | head`)
   to find the last release version.
2. Check `git diff --name-only <lastTag>..HEAD` against the Android release gate.
   If it finds no qualifying native change, stop here. Otherwise use
   `git log <lastTag>..HEAD --pretty=format:'%s'` to classify the bump (or honor
   a forced level from the invocation).
3. Compute the next `vX.Y.Z`. Summarize: last version, new version, the bump
   level, and the notable commits driving it.
4. If `confirm first` / `dry run`: print the summary and stop.
5. Otherwise bump `apps/web/package.json` to the new version, run
   `npm install --package-lock-only` so the lockfile follows, and commit both
   (`Bump version to X.Y.Z`; no `Co-Authored-By` trailer or AI attribution).
   Run `npm run validate` first; fix failures before continuing.
6. `git push`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
7. Watch the workflow: `gh run watch <id> --exit-status` (find it via
   `gh run list --workflow=release.yml --limit 1`). Confirm the release published
   with only the verified `-play.apk` asset (`gh release view vX.Y.Z`), then check the "Release to Google
   Play" step logged the versionCode against `production`, then run `play-check`
   to verify production holds it and phone testing tracks have no active releases. A failure
   in the earlier "Pre-flight Play release" step means the versionCode collides
   with one Play already has: the step's output names the
   `PLAY_VERSION_CODE_OFFSET` value to set, after which re-run the workflow.
8. Report the new version, the bump reasoning, and the release URL.

Notes:
- Web and server changes reach devices through the production deploy (`$deploy`).
  Their presence in the bundled web fallback does not override the Android
  release gate.
- `ANDROID_*` secrets sign the AAB with the upload key. Google signs the
  distributed APK; verify that signer against the existing asset-links trust list.
- Never tag a version older than or equal to the last release.
