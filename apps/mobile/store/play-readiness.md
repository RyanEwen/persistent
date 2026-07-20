# Play Store readiness — blockers before `ca.persistent.app` can ship

Found while assembling the listing. The copy and graphics are the easy part; these
are the things that will get the submission rejected or that you cannot truthfully
declare today. Roughly in order of how hard they are to fix.

---

## 1. In-app APK updater ✅ DONE (split into product flavors)

Google Play's **Device and Network Abuse** policy prohibits an app distributed on
Play from updating itself by any other route, and `REQUEST_INSTALL_PACKAGES` is
the signal review looks for. Sideloading is still wanted, so the app now builds in
two flavors instead of dropping the updater outright:

| | `direct` (GitHub) | `play` (Store) |
| --- | --- | --- |
| `UpdatePlugin` | yes | **no** |
| `REQUEST_INSTALL_PACKAGES` | yes | **no** |

- Flavor sources: `apps/mobile/android-plugin/flavor/{play,direct}/`
- `setup-android.mjs` copies them into `android/app/src/<flavor>/` and injects the `productFlavors` block
- Shared `MainActivity` calls `FlavorPlugins.register(this)` — it can't name `UpdatePlugin`, which exists in only one flavor
- Build: `npm run assemble:release` (direct APK) / `npm run bundle:play` (Play AAB)

**Verified on the built artifacts, not just the source:** the `playDebug` packaged
manifest contains **0** occurrences of `REQUEST_INSTALL_PACKAGES` and the flavor's
compiled output contains **0** `UpdatePlugin` classes; `directDebug` has both. Both
flavors compile (Kotlin + Java).

The web UI is the same hosted bundle for both flavors, so it cannot be compiled
differently — every updater surface gates on `hasNativeUpdater()`
(`Capacitor.isPluginAvailable('Update')`) instead of `isNative()`.

⚠️ **Never upload the `direct` artifact to Play.** Check before submitting:

```bash
grep -c REQUEST_INSTALL_PACKAGES \
  apps/mobile/android/app/build/intermediates/packaged_manifests/playRelease/AndroidManifest.xml   # expect 0
```

## 2. targetSdk 35 ✅ DONE (device check outstanding)

Play requires new apps and updates to target API 35+. This was a toolchain
upgrade, not a version bump — AGP 8.2.1 refuses `compileSdk 35`, and AGP 8.6 needs
Gradle 8.7, so all three moved together:

| | was | now |
| --- | --- | --- |
| compileSdk / targetSdk | 34 | **35** |
| Android Gradle Plugin | 8.2.1 | **8.6.1** |
| Gradle | 8.2.1 | **8.7** |
| SDK platform / build-tools | `android-34` / 34.0.0 | + `android-35` / 35.0.0 |

`android/` is gitignored, so `setup-android.mjs` patches all three idempotently
rather than the upgrade living in untracked files. Both flavors compile (Kotlin +
Java).

**Edge-to-edge:** API 35 stops the system insetting the window, and the app had no
inset handling anywhere. The hosted web UI sets `viewport-fit=cover` but uses no
`env(safe-area-inset-*)` rules, so the list would have run under the status bar
and the **full-screen alarm's Done/Snooze buttons under the system bars**. Insets
are now applied natively in `AlarmActivity`, `SnoozePickerActivity`
(`AlarmUi.applySystemBarInsets`) and the WebView (`MainActivity`) — natively, so
the web bundle shared with the browser PWA is untouched.

**Verified on a Pixel 9 Pro (Android 15).** Insets are correct — the header clears
the status bar and the bottom nav clears the gesture bar.

The device check also caught a regression compiling could never have shown: under
`targetSdk 35`, Android refused the alarm's activity launch with `BAL_BLOCK`, so a
ringing alarm collapsed to a heads-up banner **whenever the phone was unlocked**
(locked was unaffected, which is what made it easy to miss). Fixed by holding
`SYSTEM_ALERT_WINDOW` — see #5 and `docs/alarm-architecture.md`. Re-tested with the
phone unlocked: full-screen surface restored, zero BAL blocks in logcat.

## 2b. App access for reviewers ✅ DONE

Play reviewers must be given credentials, and none of this app's sign-in paths
work for them: the emailed one-time code needs a mailbox they don't have, and demo
mode can't help because it returns the code for *every* address (hence
`demoMode` being hard-disabled in production).

One designated account can now sign in with a fixed code —
`REVIEW_ACCOUNT_EMAIL` + `REVIEW_ACCOUNT_CODE`, both required, unset by default
(`apps/api/src/lib/review-access.ts`, documented in `docs/auth-architecture.md`).
The Play Console "App access" wording is in [`listing.md`](listing.md); the secret
itself is deliberately not in this repo.

Set on the production server and passed through `compose.server.yml`. Rotate the
code once the review concludes.

## 3. Privacy policy ✅ DONE

`apps/web/src/pages/PrivacyPage.tsx`, routed at `/privacy` **ahead of the auth
gate** in `App.tsx` so it resolves for a logged-out crawler (verified: renders
with `user: null`, and other signed-out routes still show sign-in).

Covers what's collected, the FCM / Web Push / Cloudflare / Google Sign-In third
parties, the user-configured escalation contact, retention, and deletion.

Contact address is `contact@dynamic-solutions.ca` — use the same one on the Play
listing, since Google verifies it routes.

Listing URL: `https://persistent.dynamic-solutions.ca/privacy`

## 4. Account deletion ✅ DONE

- `DELETE /api/auth/me` (`apps/api/src/routes/auth.ts`) — requires the caller to echo their own email; a session cookie alone won't trigger it.
- Settings → **Delete account** (`apps/web/src/components/DeleteAccountCard.tsx`) — dialog keeps the button disabled until the typed email matches.
- `deleteAccountSchema` in `packages/shared/src/auth.ts`.

Verified end-to-end against a throwaway account: user, reminders, occurrences,
sessions **and** `EmailCode` rows all gone. Note `EmailCode` is keyed by email
rather than `userId`, so it has no cascade and is deleted explicitly — without
that the address outlived the account.

Guards verified: wrong email → 400, missing body → 400, no session → 401, and the
account survives all three.

You can now truthfully tick "users can request data deletion" in Data Safety.

Play also wants a **public deletion URL**, which it fetches without a session:
`https://persistent.dynamic-solutions.ca/delete-account`
(`apps/web/src/pages/DeleteAccountPage.tsx`, routed ahead of the auth gate like
`/privacy`). It states what is deleted, walks through Settings → Delete account,
and gives an email fallback for anyone who can't sign in.

## 5. Restricted permissions each need a Play Console declaration 🟡

These are permitted for this app — a reminder/alarm app is exactly the allowed
use case — but each requires a written justification, and vague answers get
bounced:

| Permission | What to say |
| --- | --- |
| `USE_EXACT_ALARM` | Core function is user-set alarms that must fire at an exact time; allowed alarm-app exception. |
| `SCHEDULE_EXACT_ALARM` | Same. (`USE_EXACT_ALARM` alone may suffice on API 33+ — dropping the other reduces surface.) |
| `FOREGROUND_SERVICE_SPECIAL_USE` | Highest-risk one. Google reviews `specialUse` case-by-case and rejects weak justifications. Reuse the manifest property text: an alarm must keep sounding until explicitly confirmed, and no existing FGS type covers it. |
| `USE_FULL_SCREEN_INTENT` | Alarm surface must wake the screen over the lock screen. Alarm/calling apps qualify. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Only allowed for a narrow set of cases; exact-alarm apps qualify, but be ready to argue that Doze would otherwise defer a medication alarm. |
| `SYSTEM_ALERT_WINDOW` | **Added for targetSdk 35.** Not used to draw an overlay — it is the exemption from Android 15's background-activity-launch rules, without which a ringing alarm cannot take over the screen while the phone is unlocked (verified: `BAL_BLOCK` in logcat). Say exactly that; "display over other apps" is heavily scrutinised and a vague justification will be rejected. See `docs/alarm-architecture.md`. |

Note `SCHEDULE_EXACT_ALARM` and `USE_EXACT_ALARM` are declared together — check
whether both are actually needed at your min/target SDK, since each extra
restricted permission is another thing review can object to.

## 6b. Automated publishing ✅ WIRED (dormant until you add the secret)

`.github/workflows/release.yml` uploads the AAB to Google Play on every `v*` tag,
using the same release notes as the GitHub Release truncated to Play's
500-character limit. It is a no-op until `PLAY_SERVICE_ACCOUNT_JSON` exists, so
tagging behaves exactly as today until you switch it on.

**One-time setup, in order:**

1. **Create the app in Play Console.** The API cannot create an app, only publish
   to one that exists.
2. **Upload the first AAB by hand** (`npm run bundle:play`, or grab the
   `play-bundle-*` workflow artifact). Play requires a manual first release; the
   API takes over afterwards.
3. **Create a service account** in Google Cloud, then in Play Console →
   *Users and permissions* invite it and grant **Release manager** (or at minimum
   *Releases: create and edit*) for this app. Download its JSON key.
4. **Add the GitHub secret** `PLAY_SERVICE_ACCOUNT_JSON` — the JSON key file's
   contents, pasted whole (not base64).

After that a tag publishes automatically. `workflow_dispatch` exposes `play_track`
(`internal` default) and `play_status` if you need a one-off alpha/beta/production
push.

**Two traps:**

- **`play_status` must be `draft` until the app has been published once.** The API
  rejects a `completed` release on an app that has never gone live.
- **`versionCode` is `github.run_number`.** Play requires it to strictly increase
  and never repeat, so if a manual upload used a *higher* code than the current run
  number, every automated upload is rejected until the run number passes it. Check
  the code on your first manual upload against the workflow's run number.

## 6. AAB build ✅ DONE — Play App Signing still to decide 🟡

`npm run bundle:play` produces the AAB (`bundlePlayRelease`), and
`.github/workflows/release.yml` builds it alongside the sideload APK on every tag.
It is uploaded as a **workflow artifact**, deliberately not as a release asset —
publishing it next to the APK would invite installing the wrong one.

Still yours to decide: **Play App Signing.** If you enroll, Play holds the signing
key and your existing `release.keystore` becomes the upload key. *(The keystore is
correctly gitignored — verified.)*

Note the signing-cert consequence for passkeys: enrolling in Play App Signing means
Play re-signs the app, so the **fingerprint changes**. `assetlinks.json` and
`ANDROID_APP_ORIGIN` in `apps/api/src/lib/webauthn.ts` both hard-code the current
cert and would need Play's signing certificate added, or passkeys break on the
Play build.

## 7. `versionCode` must be monotonic 🟢

Currently `versionCode 9` / `versionName "0.4.0"` in the generated project,
overridden from env by `scripts/setup-android.mjs`. Note that the gradle value is
stale relative to the repo's 0.14.0 — harmless since CI injects it, but make sure
the Play track starts above whatever versionCode you've already published on
GitHub, and never reuse one.

## 8. Smaller things 🟢

- `android:allowBackup="true"` means reminder data goes into Google backups. Fine, but it's a Data Safety answer — either declare it or set `false`.
- The WebView loads the live site from `persistent.dynamic-solutions.ca`. This is allowed, and the substantial native alarm plugin clears Play's minimum-functionality bar comfortably — but it means **a server-side web change alters shipped app behavior without review.** Keep the hosted UI consistent with what you declared.
- Content rating questionnaire: the escalation email is a one-way system message, not user-to-user chat, so "users can communicate" is reasonably **no**.

---

## Suggested order

1. ~~Account deletion endpoint + Settings UI~~ ✅
2. ~~Write and host the privacy policy~~ ✅
3. ~~Split the updater into play/direct flavors~~ ✅
4. ~~AAB build in CI~~ ✅
5. ~~Capture screenshots~~ ✅ (`graphics/screenshots/`)
6. ~~Raise targetSdk to 35 + handle edge-to-edge~~ ✅
7. ~~Reviewer sign-in credentials~~ ✅
8. ~~Automated Play publishing in CI~~ ✅ (dormant — see #6b)
9. **Verify the alarm UI on an Android 15+ device** — the one thing compiling can't prove
10. Decide Play App Signing (watch the passkey cert consequence in #6)
11. Play Console paperwork: restricted-permission declarations (#5), Data Safety, App access and the deletion URL (`listing.md`), then submit
12. Create the app, upload one AAB manually, then add `PLAY_SERVICE_ACCOUNT_JSON` to switch CI publishing on (#6b)

**No code blockers remain.** What's left is one device check, one decision, and
console paperwork.

All listing screenshots are captured, including the ringing full-screen alarm
(`graphics/screenshots/00-ringing-alarm.png`), taken on Android 15 during the
device verification.
