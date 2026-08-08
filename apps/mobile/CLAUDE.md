# Mobile conventions (`apps/mobile`)

Capacitor (Android) wrapper of the built web app plus the custom native alarm
plugin — where the hard alarm guarantee actually lives. Architecture is in
[`docs/alarm-architecture.md`](../../docs/alarm-architecture.md); build, wireless
adb and signing are in `README.md`.

## Verifying native changes

**Native (Kotlin/Java) changes aren't covered by `npm run validate`.** The
devcontainer ships JDK 17 + the Android SDK (platform-34, build-tools 34.0.0), so
verify them by compiling: from here, `npm run verify:android` (re-syncs
`android-plugin/` into the generated project, then compiles the Kotlin **and**
Java tasks for **both product flavors**). All four tasks matter — the plugin is
Kotlin but `MainActivity.java` is Java, and the Kotlin task alone compiles right
past a broken `MainActivity`. Run `npm run prepare:android` once first if the
generated `android/` project doesn't exist yet.

## Two Android flavors

`android-plugin/flavor/`: `play` for the Play Store, `direct` for sideloaded
GitHub releases. Two things live in `direct` only, each because Play would object:

- **the in-app updater** — `direct` registers `UpdatePlugin` and declares
  `REQUEST_INSTALL_PACKAGES`; Play forbids an app it distributes from updating itself.
- **the Android Auto car screen** (`ReminderCarAppService` + its screens) — a
  templated car app must declare one of Auto's approved categories and a reminder app
  is none of them, so it stays out of the reviewed build rather than putting every
  release at risk. The Auto *notification* mirror needs no category and is shared.

Direct-only Kotlin sources are listed in `scripts/setup-android.mjs`
(`DIRECT_ONLY_KT`) and their manifest entries in `flavor/direct/AndroidManifest.xml`.
`MainActivity` is shared and calls `FlavorPlugins.register(this)`, which each flavor
supplies.
Build with `npm run assemble:release` (direct APK) or `npm run bundle:play` (Play
AAB). Both flavors load the *same* hosted web bundle, so any updater UI must gate
on `hasNativeUpdater()` (`apps/web/src/native/alarmBridge.ts`), never
`isNative()`.

## Play listing assets

**Regenerated, not hand-made.** From the repo root, `npm run db:seed:demo --
--email=…` fills the **store demo account** with the small, health-data-free set
the screenshots are taken against, and `npm run shots -- --email=…` renders four
of the six store screenshots from the running dev web app (Playwright, kept out
of `package.json` — the script prints the one-off install). The full-screen alarm
and the notification shade are native/OS surfaces and still need a device.
`store/listing.md` is the source of truth for the copy *and* the screenshot set;
both are pushed to Play by the manual `play-listing` workflow
(`scripts/play-publish.mjs --listing`). See `store/play-readiness.md`, and keep
the listing free of health framing while `MEDICATION` is withheld from the picker
(root `CLAUDE.md`).
