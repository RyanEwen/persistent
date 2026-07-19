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

## 2. `targetSdkVersion 34` is below Play's minimum 🔴 — now the only hard blocker

`apps/mobile/android/variables.gradle` has `compileSdkVersion = 34`,
`targetSdkVersion = 34`. Play requires new apps and updates to target a recent API
level — API 35 as of Aug 2025, with API 36 taking effect Aug 31 2026. Confirm the
exact floor in Play Console, but 34 will be rejected either way.

This is a **toolchain upgrade, not a version bump**. Current state:

| | now | needed |
| --- | --- | --- |
| compileSdk / targetSdk | 34 | 35+ |
| Android Gradle Plugin | 8.2.1 | 8.6+ (AGP 8.2 rejects compileSdk 35) |
| Gradle | 8.2.1 | matching AGP requirement |
| Installed SDK platforms | `android-34` only | `android-35` (`sdkmanager "platforms;android-35"`) |
| build-tools | 34.0.0 | 35.x |

On top of the toolchain: API 35 **enforces edge-to-edge**, so the WebView shell and
the full-screen `AlarmActivity` both need insets handled or the alarm UI will draw
under the status/nav bars — on the surface that matters most. Capacitor 6 targets
34 by default, so check whether the AGP bump wants a Capacitor upgrade too.

Sequence: install platform-35 → bump AGP/Gradle → bump compileSdk/targetSdk →
`npm run verify:android` (all four tasks) → **fire a real alarm on a device** and
confirm the full-screen surface still lays out correctly.

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

You can now truthfully tick "users can request data deletion" in Data Safety. The
web deletion URL Play asks for can point at `/settings` or the policy's deletion
section.

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

Note `SCHEDULE_EXACT_ALARM` and `USE_EXACT_ALARM` are declared together — check
whether both are actually needed at your min/target SDK, since each extra
restricted permission is another thing review can object to.

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
6. **Raise targetSdk to 35+** — toolchain upgrade, then re-verify the alarm UI
7. Decide Play App Signing (watch the passkey cert consequence in #6)
8. Write the restricted-permission declarations in Play Console (#5), answer Data Safety (`listing.md`), submit

**#6 is the only remaining hard blocker.** Everything else left is Play Console
paperwork or a decision, not code.
