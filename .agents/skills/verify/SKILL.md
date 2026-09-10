---
name: verify
description: "Run Persistent and observe a change on the web, Android, or desktop surface, clearly separating runtime evidence from compile checks."
---

# Verifying Persistent

Choose the smallest verification that observes the changed behavior. Run
`npm run validate` as the repository-wide static and unit-test baseline.

## Web and API

Start the development stack with `npm run dev`. The web app is at
`http://localhost:5173` and the API is at `http://localhost:4000`.

Use the integrated browser to inspect auth state before assuming the seeded
session is still valid. In demo/no-email mode, `POST /api/auth/request-code`
returns `previewCode`, which can complete sign-in without mail infrastructure.

Useful routes include `/`, `/reminders/new`, `/reminders/:id`, and
`/reminders/:id/edit`.

Browser interaction notes:

- Prefer small accessibility snapshots or targeted reads on the editor; the
  full editor tree is large.
- Joy UI `Select` is a combobox, not a native `select`: open the combobox, then
  choose its option.
- Split an interaction and its resulting state read when React has not settled.
- Use normal browser typing for controlled inputs.
- The existing `Capacitor plugin "App" already registered` console warning is
  known noise.

## Android

Run `npm run verify:android` from `apps/mobile`. It regenerates the Android
project and compiles Kotlin and Java for both `play` and `direct` debug flavors.
The devcontainer has no emulator or system image, so this is a compile check,
not runtime evidence. State that limitation unless a real device was connected
and exercised. Wireless ADB support is documented by
`.devcontainer/adb-discover.py`.

## Windows desktop

Run `npm run verify:desktop` for the non-XAML C# compile check. It does not test
XAML, code-behind, packaging, or startup. The meaningful end-to-end check is
`npm run install:desktop`, which builds and installs the working tree on the
configured Windows machine. Report which level was actually observed.
