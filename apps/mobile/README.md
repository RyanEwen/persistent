# @persistent/mobile — Capacitor Android client

Wraps the built web app (`apps/web/dist`) in a native Android shell and adds the
custom **AlarmPlugin** that provides the hard persistence guarantee: exact alarms
that fire offline, an ongoing full-screen notification, and looping sound that
stops when the user handles the reminder. During phone and voice/video calls
reported by Android, alarms wait as quiet notifications, then resume when the call
ends if still unhandled. See `../../docs/alarm-architecture.md`.

This sub-project is intentionally **not** part of the root npm workspaces (it
pulls the Capacitor/Android toolchain), so it doesn't affect `npm run validate`.
Build it from inside this directory in the development container (needs a JDK + Android
SDK; add them to `docker/dev/Dockerfile` or use Android Studio).

## Layout

- `capacitor.config.ts` — app id/name; `server.url` loads the UI from production
  (so web changes ship without a new APK), with `webDir` as the offline fallback.
- `src/alarm/` — TypeScript bridge to the native plugin (`registerPlugin`).
- `src/native-sync.ts` — pulls `/api/sync/occurrences`, schedules on-device
  alarms, registers FCM, drains native acks. Realizes "device-scheduled + server
  backup".
- `src/main.ts` — `initNative()` bootstrap; call it from the web app behind a
  `Capacitor.isNativePlatform()` check.
- `android-tests/`: native JVM regression tests, copied into both flavors by setup.
- `android-plugin/` — the Kotlin sources for the AlarmPlugin + `UpdatePlugin`
  (in-app APK download/install), copied into the generated Android project — see
  below — plus `AndroidManifest.additions.xml`.

## First-time setup

```bash
cd apps/mobile
npm install
npm run prepare:android   # build web -> cap add android -> wire plugin -> cap sync
```

`prepare:android` runs these in order (each is also a standalone script):

1. `build:web` — build `@persistent/shared` then `@persistent/web` (produces `apps/web/dist`).
2. `add:android` — `cap add android` to generate the `android/` project.
3. `setup:android` — run `scripts/setup-android.mjs`, which wires the native
   plugins into the generated project (idempotent):
   - copies `android-plugin/*.kt` into `android/.../ca/persistent/app/alarm/`,
   - copies `android-tests/*.kt` into the generated JVM test source set,
   - merges `AndroidManifest.additions.xml` into the app manifest (guarded by
     `persistent-alarm` marker comments),
   - installs `android-plugin/MainActivity.java` (registers `AlarmPlugin` +
     `UpdatePlugin`),
   - overlays the launcher icons + the notification status icon from
     `android-res/` (the bell; launcher PNGs are rasterized from `assets/*.svg`
     by `npm run gen:icons`, the status-bar icon is the vector
     `drawable/ic_stat_bell.xml`),
   - adds the `firebase-messaging` dependency and registers `FcmService` in the
     manifest (in place of Capacitor's `MessagingService`, via `tools:node="remove"`),
     so server FCM pushes are handled natively even when the bridge is dead — see
     `docs/alarm-architecture.md`,
   - adds the `androidx.car.app` dependency (with a `tools:overrideLibrary` for its
     minSdk 23) in the **`direct` flavor only**, along with the entire
     **Android Auto** integration: the `com.google.android.gms.car.application`
     meta-data plus `automotive_app_desc.xml` that project reminder notifications into
     the car (`CarProjection.kt`), and the templated car screen listing the whole
     reminder set (`ReminderCarAppService.kt`). The Play build carries no Auto surface —
     declaring the notification mirror makes it a *messaging* app in Play's Auto review,
     which a reminder app fails; see `docs/alarm-architecture.md` (Android Auto) and
     `store/play-readiness.md` #1b,
   - adds the `androidx.viewpager2` dependency, which the full-screen alarm surface
     pages the ringing set with (several occurrences can ring at once; see
     `docs/notification-behavior.md` §4b),
   - if `ANDROID_KEYSTORE_FILE` is set, copies the keystore in and injects a
     release `signingConfig` (passwords read from env at build time), plus
     `versionName`/`versionCode` from `ANDROID_VERSION_NAME`/`_CODE`.
4. `sync` — `cap sync android` to copy the web bundle + Capacitor plugins.

To turn on FCM (the wake / cross-device / closed-app backup; on-device alarms cover
the core firing), provision Firebase — it stays inert until you do:
- **APK:** drop `google-services.json` into `android/app/` before assembling (the
  generated `app/build.gradle` applies the Google Services Gradle plugin only when
  the file is present). CI injects it from the `GOOGLE_SERVICES_JSON` secret in
  `.github/workflows/release.yml`.
- **Server:** set `FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_FILE` (the native client
  only registers when the server reports `fcmEnabled`, so ship both halves together).

> The development image ships a JDK 17 + the Android SDK (see
> `docker/dev/Dockerfile`), so the project builds headlessly:
>
> ```bash
> npm run assemble:android   # ./gradlew assembleDirectDebug
> # -> android/app/build/outputs/apk/direct/debug/app-direct-debug.apk
> npm run verify:android     # sync overlay, compile both flavors, run JVM tests
> ```
>
> Both commands stop Gradle after the build and cap it at two workers by default,
> which prevents an Android compile from starving WSL. Set
> `ANDROID_GRADLE_WORKERS` for a deliberate local override.
>
> Use `verify:android` as the quick check after editing `android-plugin/` — it
> re-copies the sources, compiles Kotlin and Java for both `play` and `direct`,
> and runs each flavor's JVM tests (no full APK). The plugin is
> Kotlin, but `MainActivity.java` is Java and the Kotlin task alone will happily
> compile past a broken `MainActivity`.
> The Gradle wrapper (`gradlew`) is generated by `cap add android`. Use
> `open:android` if you prefer building/running from Android Studio.

## Running on a device (wireless adb)

USB passthrough into the development container is unreliable, so connect to a physical
device over the network (Android **Wireless debugging**):

```bash
npm run android:pair -- <phone-ip>:<pair-port>
npm run android:discover -- <phone-ip>
adb devices
npm run android:build
npm run android:install
npm run android:launch
```

The adb auth key lives in `~/.android`, which the development stack persists in a
named volume, so the device's "always allow from this computer" trust **survives
container rebuilds** — you pair once, not every rebuild.

Two things make the connection fiddly, and the development stack handles both:

- The live connection is only in the adb server's memory, so it **drops on every
  container start**.
- Android's wireless-debug **port rotates every time the toggle is flipped**, so a
  pinned address goes stale (it is never 5555).

`scripts/dev/adb-connect.sh` runs when the development container starts and tries any
`ADB_CONNECT` targets from the workspace `.env` first, then hands off to
`scripts/dev/adb-discover.py` in the background, which re-finds the phone by
scanning and remembers the result in `~/.android/adb-endpoint` (a persisted
volume) so the next start is instant.

```bash
# .env — optional; discovery also works from the remembered endpoint alone
ADB_CONNECT=192.168.1.50:43193
```

mDNS would be the obvious way to discover this and does not work here: it is
multicast, which doesn't cross the container's Docker/WSL bridge. Hence the scan —
see the header of `adb-discover.py`. To re-find the phone by hand:

```bash
python3 scripts/dev/adb-discover.py            # scan using remembered/.env hints
python3 scripts/dev/adb-discover.py 192.168.2.98:40001   # try a known endpoint first
```

From the repository root, `npm run android:test-device -- <phone-ip>` performs
native overlay setup, direct-debug assembly, rotating-port discovery, install,
and launch in one command. Use `npm run android:logs` to stream logcat for only
the running direct-debug process. Pairing ports and six-digit codes are
temporary; never store them in `.env` or shell scripts.
Both commands temporarily maximize the phone's display timeout while active and
restore the exact prior value when they finish or fail.

## Rebuild + run after web changes

```bash
npm run build:web     # rebuild the web bundle
npm run setup:android # re-wire the plugin (cap sync can regenerate files)
npm run sync          # copy web + plugins into android/
npm run open:android  # build/run in Android Studio
```

## Edge-to-edge, and why the web ships first

`MainActivity.drawEdgeToEdge()` lets the WebView fill the display under
transparent system bars, rather than padding it by the insets. Padding left a grey
band above and below every screen: that band showed the *window* background, which
the web UI's own themed background never reaches.

That makes the layout depend on the **hosted** web bundle, which the APK loads
live (`server.url` in `capacitor.config.ts`) — the top bar and bottom nav carry
`env(safe-area-inset-*)` padding to stay clear of the bars
(`apps/web/src/components/AppLayout.tsx`, `BottomNav.tsx`).

**Deploy the web change before shipping an APK that contains this.** The two
update independently, and while an old bundle is still being served a new APK
would render its header under the status bar. The reverse order is safe: with an
old APK still insetting the WebView the insets read as 0, so the new web bundle
looks exactly as before.

## Opening online and offline

The shared web UI waits behind a spinner for the session and visible data to
refresh, including on resume. A previously confirmed account can reopen saved
personal reminders offline for up to seven days, with an offline status and
Reconnect action. Queued writes wait for account confirmation on reconnect.
Shared data needs a connection. Previously scheduled alarms still fire offline;
new reminders created offline are scheduled on the device after server sync.
See `../../docs/data-event-contract.md` for the access and cache policy.

## Releases & in-app updates

Before tagging, compare the last Android tag with `HEAD`. Release a new Android
binary only for changes to native runtime code, resources, plugins, manifest, or
build configuration. Web and server changes arrive through the production deploy;
desktop changes, Store listing assets, docs, and tooling do not need a new APK or
AAB. Bundling a newer web fallback alone is not a reason to bump the version.

Tagging `v*` (e.g. `git tag v0.2.0 && git push origin v0.2.0`) triggers
`.github/workflows/release.yml`, which builds the `play` AAB and releases it to
Google Play **production**. Once Play generates its universal APK, CI downloads
and verifies its package, version and Google signing certificate against
`apps/web/public/.well-known/assetlinks.json`, then attaches
`persistent-X.Y.Z-play.apk` to the GitHub Release. Both channels now share
`ca.dynamicsolutions.persistent` and the Play App Signing identity. CI never
publishes a locally signed direct APK as a substitute. The upload keystore still
signs the AAB before Google re-signs it for distribution.

The Play upload targets production only and clears active phone testing releases
in the same edit. Play rejects a second upload of a versionCode it has seen, so
`play-promote` can move an existing upload to production without rebuilding.
Manual release runs can hold a release as a `draft`, but cannot select tester
tracks. They build the named tag and receive a fresh versionCode.

The `PLAY_SERVICE_ACCOUNT_JSON` secret is required; a missing key fails the release. Before
the Android build, the workflow pre-flights the release — it authenticates, prints
every track's current versionCodes, and fails within seconds if this run's
versionCode isn't strictly higher than everything on Play (the code is baked in at
assemble time, so finding that afterwards would waste the whole build). The fix it
prints is the `PLAY_VERSION_CODE_OFFSET` repo variable, added to the run number.
See [`store/play-readiness.md`](store/play-readiness.md) §6b.

Users can update through Google Play or manually install newer GitHub APKs.
The app does not download APK updates itself. Because the UI loads from `server.url`, web-only
changes reach devices via a production deploy with no new APK. Rebuild the shell
only for native changes (alarm/plugins, manifest, launcher icon).

Legacy `ca.persistent.app` direct installs cannot update to the new APK: both
package and signer differ. Their hosted UI displays a one-time migration notice
and permanent Settings guidance. `/api/app/latest-release` remains available but
returns `null`, so older bundled clients never offer the incompatible APK. Users
install the new app from GitHub or Google Play, sign into the same account, verify saved reminders,
then remove the old app to avoid duplicate alerts. The Play flavor has neither
an in-app APK installer nor Android Auto. Retain the direct certificate in
asset links and allowed passkey origins for existing installations.

The manual `replace-github-apk` workflow (`play-apk.yml`) can replace an existing
release's direct APK with a verified Google-signed APK using its tag and existing
Play versionCode. It uploads the replacement before deleting the direct asset,
preserves approved release notes, and does not rebuild or re-upload the AAB.
If no universal APK exists or certificate verification fails, publication stops.

The listing is not hand-maintained in the Console: `store/listing.md` (copy) and
`store/graphics/screenshots/` (images) are the source of truth, pushed together by
the manual `play-listing` GitHub workflow. Regenerate the scripted screenshots with
`npm run db:seed:demo` + `npm run shots` from the repo root; only the full-screen
alarm and the notification shade still need a device.

Tagging a version publishes directly to production. The manual `play-promote`
workflow remains for already-uploaded builds and production rollout adjustments.
It copies the existing release notes, can stage the rollout to a fraction of users,
and clears active phone testing releases in the same edit.

To build a signed release locally, set the `ANDROID_*` vars (see `.env.example`)
in the workspace `.env`, then:

```bash
set -a; . ../../.env; set +a
npm run prepare:android
npm run assemble:release   # -> android/app/build/outputs/apk/direct/release/app-direct-release.apk
npm run bundle:play        # -> android/app/build/outputs/bundle/playRelease/app-play-release.aab
```

## Product flavors (`play` | `direct`)

Both distribution channels now use the Play flavor. The direct flavor remains
for legacy compatibility and local testing, including the native updater and
Android Auto capabilities that Google Play does not allow in this app:

| | `direct` (legacy/local builds) | `play` (Play and GitHub) |
| --- | --- | --- |
| `UpdatePlugin` | compiled in, registered | absent |
| `REQUEST_INSTALL_PACKAGES` | declared | **not** declared |
| Updates via | retired; install the new app | Google Play or manual GitHub APKs |
| Android Auto **car screen** (`ReminderCarAppService`) | compiled in, declared | absent |
| Android Auto **notification** mirror | yes | **no** |

The whole Auto integration is split out because a templated Auto app has to declare one
of Auto's approved categories and a reminder app is none of them. The Play artifact has
no Auto dependency, implementation classes, manifest entries, or resources. See
`store/play-readiness.md` #1a and #1b.

Sources live in `android-plugin/flavor/<flavor>/`, and direct-only Kotlin files are
listed in `setup-android.mjs`'s `DIRECT_ONLY_KT`; the script copies both into
`android/app/src/<flavor>/` and injects the `productFlavors` block. The shared
`MainActivity` calls `FlavorPlugins.register(this)` rather than naming
`UpdatePlugin`, which only exists in one flavor.

**Never publish the `direct` build to Play** — `REQUEST_INSTALL_PACKAGES` plus a
self-updater is a Device and Network Abuse violation, and the car screen would draw an
Auto review. CI asserts both on every release. To confirm what a build actually
contains:

```bash
grep -cE 'REQUEST_INSTALL_PACKAGES|androidx.car.app|com.google.android.gms.car.application' \
  android/app/build/intermediates/packaged_manifests/playRelease/AndroidManifest.xml   # expect 0
```

Because both flavors load the same hosted web UI, direct-build migration guidance is gated at
runtime on `hasNativeUpdater()` (`Capacitor.isPluginAvailable('Update')`), not at
build time.

## Verifying the guarantee

1. Create a reminder due in ~1 minute (persistence ALARM, repeating sound).
2. Put the device in **airplane mode**, lock it, wait.
3. Expect: the alarm fires offline, shows full-screen over the lock screen, loops
   the sound, and is not swipe-dismissable. Only **Done** stops it.
4. Re-enable networking — the queued ack is delivered to the server (the
   occurrence flips to ACKNOWLEDGED and clears on other devices).
5. Reboot the device with a future alarm pending; confirm it still fires
   (`BootReceiver` re-arms from `AlarmStore`).
6. Exercise the call deferral checks in `docs/notification-behavior.md`, including
   an ignored alarm, a handled alarm, and a call starting during an active alarm.
