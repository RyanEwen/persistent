# Play Store readiness — blockers before `ca.persistent.app` can ship

Found while assembling the listing. The copy and graphics are the easy part; these
are the things that will get the submission rejected or that you cannot truthfully
declare today. Roughly in order of how hard they are to fix.

---

## 1. The in-app APK updater is a policy violation — must be removed 🔴

`apps/mobile/android-plugin/UpdatePlugin.kt` downloads a release APK via
`DownloadManager` and launches the package installer; the manifest carries
`REQUEST_INSTALL_PACKAGES`; `apps/api/src/routes/app-release.ts` polls GitHub
Releases for the newest build; `apps/web/src/components/GetTheApp.tsx` links to
the GitHub release page.

Google Play's **Device and Network Abuse** policy prohibits an app distributed on
Play from updating itself through any mechanism other than Play's own update
system. This is not a gray area and `REQUEST_INSTALL_PACKAGES` is exactly the
signal review looks for.

**Fix:** for the Play build, drop `UpdatePlugin.kt`, remove the
`REQUEST_INSTALL_PACKAGES` permission from `setup-android.mjs`, and hide the
in-app update prompt and the GitHub download link. Play handles updates.

Worth deciding first: **do you want Play to replace GitHub distribution, or run
alongside it?** They can't share one build. If you keep sideloading for yourself,
you need a product flavor — Play build without the updater, direct build with it —
because a single artifact can't satisfy both.

## 2. `targetSdkVersion 34` is below Play's minimum 🔴

`apps/mobile/android/variables.gradle` has `compileSdkVersion = 34`,
`targetSdkVersion = 34`. Play requires new apps and updates to target a recent API
level — API 35 as of Aug 2025, with API 36 taking effect Aug 31 2026. Confirm the
exact current floor in Play Console, but 34 will be rejected either way.

Raising it is not a one-line change: API 35 enforces edge-to-edge display and
tightens foreground-service behavior, both of which touch this app's alarm UI
directly. Budget real time and re-run `npm run verify:android`.

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

## 6. Play wants an AAB, and Play App Signing 🟡

`npm run assemble:release` produces an APK. Play requires an **Android App Bundle**
(`./gradlew bundleRelease`) for new apps. Also decide on Play App Signing: if you
enroll, Play holds the signing key and your existing `release.keystore` becomes
the upload key. *(The keystore is correctly gitignored — verified.)*

CI currently builds a signed APK for GitHub Releases; it'll need a parallel bundle
step for Play.

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
2. ~~Write and host the privacy policy~~ ✅ (confirm the contact mailbox)
3. Decide GitHub-vs-Play distribution (gates #4)
4. Strip the updater → product flavor if needed
5. Raise targetSdk to 35+, fix edge-to-edge, `verify:android`
6. Bundle build in CI, capture screenshots, submit

The two quick ones are done. Steps 3–5 are the real work, and step 3 is a product
decision only you can make.
