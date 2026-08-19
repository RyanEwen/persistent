# Play Store readiness — blockers before the Play build can ship

**Package names differ by flavor.** Play requires `ca.dynamicsolutions.persistent`,
so that is the `play` flavor's `applicationId`; the sideloaded GitHub build keeps
`ca.persistent.app`. Both are independent of the Kotlin/Java namespace, which stays
`ca.persistent.app` throughout. Consequences that bit us once already: Firebase
needs an Android app per package (else `processPlayReleaseGoogleServices` fails),
and `assetlinks.json` + `ANDROID_APP_ORIGIN` need an entry per package *and* per
signing certificate or passkeys break on that build.

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
| `ReminderCarAppService` (Android Auto screen) | yes | **no** — see #1a |
| `com.google.android.gms.car.application` (Auto notification mirror) | yes | **no** — see #1b |

- Flavor sources: `apps/mobile/android-plugin/flavor/{play,direct}/`
- `setup-android.mjs` copies them into `android/app/src/<flavor>/` and injects the `productFlavors` block
- Shared `MainActivity` calls `FlavorPlugins.register(this)` — it can't name `UpdatePlugin`, which exists in only one flavor
- Build: `npm run assemble:release` (direct APK) / `npm run bundle:play` (Play AAB)

**Verified on the built artifacts, not just the source:** the `playDebug` packaged
manifest contains **0** occurrences of `REQUEST_INSTALL_PACKAGES` and the flavor's
compiled output contains **0** `UpdatePlugin` classes; `directDebug` has both. Both
flavors compile (Kotlin + Java). The same check covers Auto: the built `playDebug` APK
has **no** `com.google.android.gms.car.application` meta-data, **no**
`ReminderCarAppService`, and **no** `res/xml/automotive_app_desc.xml`; `directDebug` has
all three. Check the APK, not the source — the entry reached the Play build for months
because it was merged into `src/main` by `setup-android.mjs`, which no source file for
the `play` flavor mentions.

### 1b. The Auto notification mirror was the actual policy hit

On 2026-08-17 Play raised *Auto App Quality Guidelines: Message functionality* against
the app — "your app is not able to send outgoing messages / receive incoming messages" —
with updates to be rejected until fixed. Nothing about the car *screen* caused it: that
was already direct-only. The cause was `<meta-data com.google.android.gms.car.application>`
pointing at `<uses name="notification"/>`, which shipped in **both** flavors on the
reasoning that it "needs no category". It needs no category, but to Auto it means *this
app sends and receives messages*, and review holds it to that. A reminder app cannot pass
a messaging test, so the declaration moved to `direct` — which is the alternative Play's
own remediation offers ("exclude your app from Android Auto by removing the Android Auto
manifest entry"). The Play build now has no Auto surface; the sideloaded build keeps
both the mirror and the screen.

Two things follow from it, and both are done: the store description no longer claims the
app works in the car (`listing.md`), and `CarProjection.init` reads the app's own manifest
for the declaration rather than trusting a flavor constant, so the Play build never even
observes the car connection.

The web UI is the same hosted bundle for both flavors, so it cannot be compiled
differently — every updater surface gates on `hasNativeUpdater()`
(`Capacitor.isPluginAvailable('Update')`) instead of `isNative()`.

⚠️ **Never upload the `direct` artifact to Play.** CI now asserts this on every
release ("Verify the Play bundle carries no direct-only components"): it locates the
`playRelease` packaged manifest and fails the run if any direct-only marker appears —
`REQUEST_INSTALL_PACKAGES`, `androidx.car.app.CarAppService`, or
`com.google.android.gms.car.application`. **Add a marker the moment a component becomes
flavor-specific.** The Auto notification meta-data was missing from this list, so the
step ran green for months while the entry shipped in the Play build and eventually drew
the enforcement in #1b — the guard was only ever as good as its list.

Comments are stripped before matching, because a comment is not a declaration:
`src/main`'s manifest carries a note saying where the Auto entry lives now, and a plain
grep counted that note as the entry. A guard that fails every release on prose gets
weakened rather than fixed.

To check by hand:

```bash
perl -0777 -pe 's/<!--.*?-->//gs' \
  apps/mobile/android/app/build/intermediates/packaged_manifests/playRelease/*/AndroidManifest.xml |
  grep -cE 'REQUEST_INSTALL_PACKAGES|androidx.car.app.CarAppService|com.google.android.gms.car.application'   # expect 0
```

Run the same against `directRelease` and expect a non-zero count — a guard nobody has
seen fail is a guard nobody knows works.

(CI searches for that path rather than hard-coding it, since AGP relocates
`packaged_manifests` between versions. If the manifest can't be found the step
warns instead of failing, so an AGP upgrade can't block a release — but that
warning means the check has stopped running and the path needs updating.)

## 1a. Android Auto car screen ✅ DONE (kept out of the Play build)

Android Auto's **notification** extension — mirroring a nag into the car as a
`MessagingStyle` notification — needs no app category, which is why it shipped in
**both** flavors until Play enforced against it. It is `direct`-only now, for the
reasons in #1b, and the CI guard above covers its manifest entry.

A **templated car app** (`CarAppService`) is different: it must declare one of Auto's
approved categories, and a reminder app is honestly none of them — navigation,
parking, charging, POI, IOT, settings, messaging, calling, weather. Declaring one
anyway puts an Auto review in the path of *every* Play release, and a rejection there
blocks the whole release, not just the car part. Not worth it for a screen, so
`ReminderCarAppService` and its screens went into the `direct` flavor. The sideloaded
build declares `SETTINGS`, the least-wrong of the set.

Consequence to remember: seeing the car screen needs Android Auto's developer setting
**"Add new apps to launcher"**, as any sideloaded car app does (Auto only runs car
apps from Play-installed apps otherwise). That is a one-time toggle on the phone.

**If this is ever wanted on Play**, the decision to revisit is the category — check
what the Play Console's Android Auto declaration will actually accept for this app
before moving the manifest entry out of `flavor/direct/`, and move the sources out of
`DIRECT_ONLY_KT` in `setup-android.mjs` at the same time. The CI assertion above will
fail loudly until both are done deliberately.

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

## 2a. targetSdk 36 ✅ DONE

Play requires updates to target the API level of the last Android release: from
2026-08-30 that is **Android 16 (API 36)**, and the console flagged the app on
2026-08-18 with "your highest non-compliant target API level is Android 15".

Same shape as #2 — a toolchain upgrade, not a version bump, since AGP caps the
compileSdk it will build:

| | was | now |
| --- | --- | --- |
| compileSdk / targetSdk | 35 | **36** |
| Android Gradle Plugin | 8.6.1 | **8.13.2** (max API 36.1) |
| Gradle | 8.7 | **8.13** (AGP 8.13's minimum) |
| SDK platform / build-tools | `android-35` / 35.0.0 | + `android-36` / 36.0.0 |

JDK 17 is unchanged (AGP 8.13's minimum is still 17). Both flavors compile, both
built APKs report `targetSdkVersion:'36'`, and the Play one still carries no
direct-only component.

**Predictive back was opted out for this release only**
(`android:enableOnBackInvokedCallback="false"`, applied by `setup-android.mjs`).
Targeting 36 turns it on by default, and an app that opts in stops receiving
`onBackPressed()` and `KEYCODE_BACK`, which is where this app's back behaviours lived:
`AlarmActivity` overrode `onBackPressed` to do nothing (that is what stops Back
dismissing a **ringing alarm**) and `SnoozePickerActivity` stepped out of its custom
view with it. Opting in without migrating them would have turned Back into "finish the
activity", i.e. Back would kill a ringing alarm, so the opt-out kept the behaviour
still while the API level moved. The migration landed straight after this device pass
and flipped the flag to `"true"`; see `docs/alarm-architecture.md` (Predictive back)
and the results below.

**Checked and not applicable:** the 16 KB page-size requirement (the app ships no
`.so` — nothing to re-align), intent-redirection hardening (the only
`getParcelableExtra` is a `Uri` from the system ringtone picker, not a nested
intent), and ordered-broadcast priority scoping (the app is single-process). Edge-to-edge
needs nothing new: the opt-out attribute API 36 removes was never used, and the insets
added in #2 already handle it.

**Verified on a Pixel 9 Pro (Android 17 / SDK 37) running versionCode 45**, against the
production account, because #2 is the reason to take a device check seriously: that bump
compiled clean and still broke the alarm on real hardware, which no build could have
shown. Each check below is what the API 35 bump would have failed.

- **A ringing alarm takes over the screen unlocked.** The alarm was armed from a
  snooze, the app pushed fully to the background behind the launcher, and the
  full-screen surface came up on time with **zero `BAL_BLOCK`** entries in logcat. This
  is the exact path #2 broke.
- **And locked.** `mKeyguardOccluded=true` with the surface on top, and on the run
  where the phone was left alone the device went `Dozing` to `Awake` as it fired, so
  `setTurnScreenOn` still works.
- **Back does nothing on the alarm surface**: the key event, a left-edge gesture and a
  right-edge gesture all left `AlarmActivity` top-resumed.
- **Back inside the snooze picker's custom view returns to the presets.** Back at the
  presets root closes the picker, which is `SnoozePickerActivity.onBackPressed` behaving
  as written; the alarm keeps ringing behind it, since opening the picker deliberately
  finishes the alarm surface.
- **Back in the app walks the hierarchy**: a non-first tab goes to the first tab, and
  the first tab leaves the app, matching `useNativeBack.ts` exactly.
- **The WorkManager sync still runs** under API 36's tighter quotas. The job reports
  `WITHIN_QUOTA` satisfied and `Doze whitelisted: true`; a `syncNow` worker ran within
  130 ms of each native snooze/Done, and the 15-minute periodic worker fired on its own
  with the app closed.

Also confirmed while there: `USE_FULL_SCREEN_INTENT` and `USE_EXACT_ALARM` are granted,
alarms are armed as exact `RTC_WAKEUP` with `exactAllowReason=policy_permission`, and
Android 16's audio hardening does **not** mute the alarm: the player logs
`muted ... source:none` while the app is in the background.

Home still leaves an alarm ringing rather than dismissing it (foreground service and
ongoing notification both survive, and tapping the notification reopens the surface).
That is deliberate and matches the system clock; no app can intercept Home outside
device-owner lock-task mode.

**Re-verified with predictive back turned on**, on the same device, once the migration
described above landed. Every back check gave the same answer as it did with the flag
off: inert on the alarm surface for the key and both edge gestures, the picker's custom
view stepping back to the presets, the presets closing the picker while the alarm kept
ringing, and the tab hierarchy walking to the first tab and then out of the app. The
alarm's background launch was re-checked too, by backgrounding the app with an alarm
ringing and turning the screen off and on so `AlarmService` force-presents the surface:
it came up with zero BAL blocks.

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
bounced.

Play additionally demands a **demonstration video** for the foreground-service,
full-screen-intent and exact-alarm declarations. Recordings are in
`graphics/video/permission-*.mp4` (see [`listing.md`](listing.md) for what each
shows); upload them to YouTube as unlisted and paste the URLs, since the forms
take a link rather than a file.

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

## 6b. Automated publishing ✅ LIVE (internal + alpha)

`.github/workflows/release.yml` releases the AAB to Google Play on every `v*` tag,
using the same release notes as the GitHub Release truncated to Play's
500-character limit. The one-time setup below is done and
`PLAY_SERVICE_ACCOUNT_JSON` is set, so tags publish without a Console visit.

**A tag goes to `internal` *and* `alpha`** — one build, one versionCode, both
tracks. Promotion to beta/production stays a deliberate Console action.

That "both tracks" requirement is why publishing is a script
(`apps/mobile/scripts/play-publish.mjs`) rather than an off-the-shelf upload
action: **Play rejects a second upload of a versionCode it already has**, so two
sequential single-track uploads cannot put one build on two tracks. The script
creates a single Play edit, uploads once, attaches that versionCode to every
requested track, and commits once. It is dependency-free (Node 20 fetch + RS256
signing), and its request sequence is covered by `play-publish.test.ts` against a
mock Play API.

**Pre-flight.** Before the Android build, CI runs
`node scripts/play-publish.mjs --check --version-code <n>`, which authenticates,
prints every track's current releases, and fails in seconds if `<n>` isn't strictly
above everything on Play. This matters because **versionCode is baked in at
assemble time** — without the pre-flight a collision only surfaces at upload, after
a full build. It uses a throwaway edit and deletes it, so it changes nothing.

**versionCode is `github.run_number` + `PLAY_VERSION_CODE_OFFSET`.** Play requires a
strictly increasing, never-reused code. The run number does that unaided; the
offset (an Actions *variable*, not a secret; unset means 0) is the escape hatch for
when a manual upload already burned a higher code. The pre-flight failure prints the
exact offset to set:

```bash
gh variable set PLAY_VERSION_CODE_OFFSET --body "100"
```

Raise it only — lowering it re-burns codes Play has already seen.

**Ad-hoc runs.** `workflow_dispatch` takes an existing tag plus `play_tracks`
(`internal,alpha` default, or a single track) and `play_status` (`completed` /
`draft`). It builds *the named tag*, not the branch it was dispatched from. Note it
is a fresh build, so it gets a new versionCode — it is not a promotion of the
build already on internal.

**Setup that was done (for reference, or a second app):**

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

**Remaining trap:** `play_status` must be `draft` on an app that has never been
published — the API rejects `completed` on a draft app. This app is past that, so
`completed` is the default. The script also handles Play declining to auto-submit
for review (it retries the commit with `changesNotSentForReview=true`) rather than
failing the release.

### Store listing copy

[`listing.md`](listing.md) is the source of truth for the short and full
descriptions, and `graphics/screenshots/` for the phone screenshots. Both go up
together via `.github/workflows/play-listing.yml` (`workflow_dispatch`, never on a
release — the listing changes on its own schedule). `check` is the default mode and
only diffs; `publish` writes. The same service account covers this, so no extra
grant was needed beyond step 3.

The descriptions are written via **PATCH** — the app title, promo video and
localized graphics share that resource, and a PUT omitting them clears them.

Screenshots are a separate API and are **replaced wholesale**: Play has no stable
identity for "the third screenshot", so there is nothing to diff a local file
against. The delete and the six uploads all live inside the one edit, so a failure
part-way leaves the live listing untouched — the edit simply never commits. Upload
order is the display order, which is why the files are numbered and the script
sorts by name. `--no-screenshots` pushes copy alone.

Play wants **24-bit PNG with no alpha**; `adb exec-out screencap` produces RGBA, so
device shots need `magick … -alpha remove -alpha off`. The script checks this (plus
the 320–3840px and 2–8 count rules) before opening an edit, because Play's own
rejection doesn't name the offending file.

Two things to know before pushing:

- **The edits API has no merge.** Anything edited by hand in the Console is
  overwritten. Run `check` first; it reports per-field CHANGED/unchanged.
- **`listing.md` can run ahead of what's live.** It did for months — the
  CHECKLISTS section and the monthly-schedule bullet were added here and never
  reached Play, partly because the description had quietly grown past the 4,000
  cap and could not be pasted in. The publisher now refuses an over-limit
  description instead of letting it rot.

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
8. ~~Automated Play publishing in CI~~ ✅ live, internal + alpha (#6b)
9. ~~Verify the alarm UI on an Android 15+ device~~ ✅ (Pixel 9 Pro, Android 15 — see #2)
10. ~~Create the app, upload one AAB manually, add `PLAY_SERVICE_ACCOUNT_JSON`~~ ✅ (#6b)
11. Decide Play App Signing (watch the passkey cert consequence in #6)
12. Play Console paperwork: restricted-permission declarations (#5), Data Safety, App access and the deletion URL (`listing.md`), then submit

**No code blockers remain.** What's left is one decision (Play App Signing) and
console paperwork. Tagging a release now puts the build in front of internal and
alpha testers with no manual step.

All listing screenshots are captured, including the ringing full-screen alarm
(`graphics/screenshots/00-ringing-alarm.png`), taken on Android 15 during the
device verification.
