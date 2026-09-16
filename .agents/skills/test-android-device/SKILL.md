---
name: test-android-device
description: "Build, connect, install, launch, and inspect Persistent on a physical Android device over wireless ADB. Use for Android device smoke tests; do not use for emulator-only or web-only validation."
---

# Test Android Device

Run a physical-device smoke test for the current Persistent checkout.

1. Review `git status --short`, the mobile change scope, `apps/mobile/AGENTS.md`, and
   `apps/mobile/README.md`. Never edit `apps/mobile/android/`; it is generated from the tracked
   native overlay and setup script.
2. Confirm the command is running in the development environment that provides Java, Android SDK
   platform 36, and build tools 36.0.0. Do not install these globally merely to run the workflow.
3. If the device is not paired and the user supplied a current pairing endpoint and code, run
   `npm run android:pair -- <host:pairing-port>` in a PTY and enter the code through stdin. Pairing
   endpoints and codes are temporary secrets: never place them in commands, files, logs, or Git.
   After one refused or expired pairing endpoint, stop and request a newly displayed endpoint and
   code rather than retrying stale credentials.
4. Run `npm run android:test-device -- [host-or-host:port]` when the device is already paired. It
   reapplies the tracked native overlay, discovers the rotating wireless-debug port, assembles and
   installs the direct debug flavor, and launches `ca.persistent.app`. Device helpers capture the
   current display timeout, maximize it while active, and restore the exact captured value on exit.
5. If a phase fails, retry only that phase with the narrower root commands documented in the mobile
   README. Use `npm run android:logs` when runtime evidence is needed. Any direct ADB testing outside
   those helpers must follow the same capture, maximize, and guaranteed-restore display-timeout
   lifecycle. Do not clear app data, uninstall the app, revoke pairing, or make other phone-setting
   changes unless the user explicitly asks.
6. Report the connected device, APK path, install result, launch result, and which real-device alarm
   checks were exercised. A successful compile or launch is not evidence that exact alarms,
   full-screen intents, lock-screen behavior, or notification persistence work.
