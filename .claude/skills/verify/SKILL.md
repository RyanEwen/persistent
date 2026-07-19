---
name: verify
description: Run Persistent end-to-end and observe a change working — dev servers, the browser surface, and what can/can't be verified for the native Android layer.
---

# Verifying Persistent

## Web surface (apps/web + apps/api) — the one you can actually drive

```bash
npm run dev > /tmp/dev.log 2>&1 &
until grep -qE "API listening" /tmp/dev.log; do sleep 1; done
```

Web on `http://localhost:5173`, API on `:4000`. The devcontainer's Postgres (`db`)
already holds a signed-in session and seed reminders, so **no auth flow is needed** —
navigating to `/` lands on the reminders list already authenticated. (If it ever
doesn't: `demoMode`/no-email mode makes `POST /api/auth/request-code` return
`previewCode` in the response and log it, so you can complete the code sign-in.)

Drive it with the integrated browser MCP. Useful routes:

- `/` — reminders list + attention cards
- `/reminders/new`, `/reminders/:id`, `/reminders/:id/edit`

### Gotchas

- `browser_snapshot` on the editor blows the token limit (~4700 a11y nodes). Use
  `browser_eval` returning small structured data instead, and `browser_screenshot`
  when the visual is the point.
- Joy UI `Select` is not a native `<select>` — click `[role=combobox]`, wait ~200ms,
  then click the `[role=option]`.
- React state settles after the eval's synchronous tail, so a click and its
  resulting DOM read must be split across two evals (or wrapped in a
  `setTimeout` promise).
- Setting a controlled input's `.value` directly is ignored by React; use the
  native property setter + `dispatchEvent(new Event('input',{bubbles:true}))`.
- A pre-existing console warning — `Capacitor plugin "App" already registered` —
  is noise, not a regression.

## Native Android surface (apps/mobile) — usually NOT verifiable here

The devcontainer has JDK 17 + the Android SDK but **no emulator binary and no
system images**, and typically no device on `adb devices`. So notification
behavior (taps, alarms, channels, Auto) can only be **compile-checked**:

```bash
cd apps/mobile && npm run verify:android   # re-syncs android-plugin/, compiles Kotlin + Java
```

That covers both `:app:compileDebugKotlin` and `:app:compileDebugJavaWithJavac`
(`MainActivity.java` is Java; the Kotlin task alone compiles past a broken one).
Say plainly in the report that the native runtime path was not observed; don't
imply a compile is a verification.

A real phone can be reached over wireless ADB when one is paired — see
`.devcontainer/adb-discover.py`.
