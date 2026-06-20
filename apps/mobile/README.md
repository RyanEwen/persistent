# @persistent/mobile — Capacitor Android client

Wraps the built web app (`apps/web/dist`) in a native Android shell and adds the
custom **AlarmPlugin** that provides the hard persistence guarantee: exact alarms
that fire offline, an ongoing full-screen notification, and looping sound that
stops only when the user taps **Done**. See `../../docs/alarm-architecture.md`.

This sub-project is intentionally **not** part of the root npm workspaces (it
pulls the Capacitor/Android toolchain), so it doesn't affect `npm run validate`.
Build it from inside this directory in the devcontainer (needs a JDK + Android
SDK; add them to the devcontainer image or use Android Studio).

## Layout

- `capacitor.config.ts` — app id/name; `webDir` points at the web build.
- `src/alarm/` — TypeScript bridge to the native plugin (`registerPlugin`).
- `src/native-sync.ts` — pulls `/api/sync/occurrences`, schedules on-device
  alarms, registers FCM, drains native acks. Realizes "device-scheduled + server
  backup".
- `src/main.ts` — `initNative()` bootstrap; call it from the web app behind a
  `Capacitor.isNativePlatform()` check.
- `android-plugin/` — the Kotlin sources for the AlarmPlugin (copied into the
  generated Android project — see below) plus `AndroidManifest.additions.xml`.

## First-time setup

```bash
cd apps/mobile
npm install
npm run build --workspace @persistent/web --prefix ../..   # produce apps/web/dist
npx cap add android                                          # generate android/
```

Then wire the native plugin into the generated project:

1. Copy `android-plugin/*.kt` into
   `android/app/src/main/java/ca/persistent/app/alarm/`.
2. Merge `android-plugin/AndroidManifest.additions.xml` into
   `android/app/src/main/AndroidManifest.xml` (permissions at top level;
   service/activity/receivers inside `<application>`).
3. Register the plugin in `MainActivity.kt`:
   ```kotlin
   import ca.persistent.app.alarm.AlarmPlugin
   class MainActivity : BridgeActivity() {
     override fun onCreate(savedInstanceState: Bundle?) {
       registerPlugin(AlarmPlugin::class.java)
       super.onCreate(savedInstanceState)
     }
   }
   ```
4. Add the Firebase config (`google-services.json`) + the Google Services Gradle
   plugin for FCM (`@capacitor/push-notifications`). FCM is the wake/escalation
   backup; on-device alarms cover the core firing.

## Build + run

```bash
npm run build --workspace @persistent/web --prefix ../..    # rebuild web
npx cap sync android                                         # copy web + plugins
npx cap open android                                         # build/run in Android Studio
```

## Verifying the guarantee

1. Create a reminder due in ~1 minute (persistence ALARM, repeating sound).
2. Put the device in **airplane mode**, lock it, wait.
3. Expect: the alarm fires offline, shows full-screen over the lock screen, loops
   the sound, and is not swipe-dismissable. Only **Done** stops it.
4. Re-enable networking — the queued ack is delivered to the server (the
   occurrence flips to ACKNOWLEDGED and clears on other devices).
5. Reboot the device with a future alarm pending; confirm it still fires
   (`BootReceiver` re-arms from `AlarmStore`).
