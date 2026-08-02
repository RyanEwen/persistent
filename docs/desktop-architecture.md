# Desktop architecture (Windows tray app)

`apps/desktop` is a WinUI 3 tray app that shows the hosted Persistent PWA in a
flyout near the notification area. Read this before changing it, and read
[`alarm-architecture.md`](alarm-architecture.md) first for why the guarantees are
split the way they are.

## What it is, and what it deliberately is not

**It is a viewing and acting surface. It is not a nag surface.**

The flyout hosts the real web app, so everything the web client can do works here
— sign in (including passkeys, see below), Done / Snooze / De-escalate, the
editor, checklists, history. What it does **not** do is provide the persistence
guarantee: no toast notifications, no alarm audio, no on-device scheduled alarms,
nothing while the app is closed. That still lives only in the Android client.

This is the honest description and the docs, the Connection page and the About
page all say it. A Windows app that *looked* like it would nag you, and then
didn't because the machine was asleep, would be worse than no Windows app.

The one ambient signal it does provide is the **tray icon badge**: a count of
occurrences currently nagging, red when one has escalated.

## Why a WebView, not a native client

The obvious build — native XAML lists over the REST API — was rejected. Hosting
the shipped PWA instead means:

- **No duplicated contract.** No hand-maintained C# mirrors of
  `@persistent/shared` to drift from the server.
- **No second implementation of the done/silence/snooze rules.**
  [`notification-behavior.md`](notification-behavior.md) requires every surface to
  converge on the same outcome; a surface that *is* the web client cannot diverge
  from it.
- **Sign-in for free, including passkeys.** WebView2 is Chromium and exposes
  `navigator.credentials`, so Windows Hello works — unlike the Android WebView,
  which has none and forced a native `PasskeyPlugin` (see
  [`auth-architecture.md`](auth-architecture.md)).
- **The right time zone by construction.** The page reports
  `Intl.DateTimeFormat().resolvedOptions().timeZone`. A native client would have
  sent `TimeZoneInfo.Local.Id` — a Windows id like `"Eastern Standard Time"` — and
  `verify-code` accepts any string up to 64 chars, so that would have been stored
  on the `User` and then silently broken **every** schedule the user owns:
  `expandSchedule` returns `[]` for an unparseable zone, so nothing would
  materialize, on any device.

The cost is that the host is coupled to the web bundle's behavior, which is what
the bridge below is for.

## Process model

One resident process. `App.OnLaunched` takes a named-mutex single-instance lock
(a second launch posts a "show the flyout" message to the first and exits), then
creates an **invisible tool window** (`MainWindow`) that owns the tray icon via
`Shell_NotifyIcon` and lives for the session.

`MainWindow` also builds `AppFlyout` **at startup**, hidden. That is deliberate
and load-bearing:

- The flyout is shown and hidden thereafter, never rebuilt. A cold WebView2 plus a
  page load is a visible pause on every tray click.
- More importantly, **the page's own `/ws` socket is what feeds the badge**. Tear
  the WebView down between opens and the tray count would only be correct while
  you were already looking at it.

`TrayIconRenderer` composes the badge onto the app mark with `System.Drawing` and
hands back an HICON (the caller owns it; it is destroyed on the next update).

## The bridge (`apps/web/src/native/desktopBridge.ts`)

Three hosts now load **one** hosted bundle: browser, Capacitor/Android, and this
WebView2. None can be compiled in, so every difference is runtime feature
detection — the same rule that already governs `hasNativeUpdater()`.

- `isDesktopHost()` tests for `window.chrome.webview`. **Keep it distinct from
  `isNative()`**: Capacitor is absent here, so `isNative()` is false in the
  desktop host, and code that conflates the two silently misbehaves on one of
  them.
- `reportBadge(count, escalated)` posts `{type:'badge', count, escalated}` to the
  host. `DesktopBadge` (mounted in the signed-in shell, like `UpdateCheck`) drives
  it from the active-occurrence query, and clears it on unmount so signing out
  doesn't leave a stale count in the tray.
- `hostSupportsPush()` is false on desktop. WebView2 may still *report* the Push
  API as present, so a plain capability check would offer a notification toggle
  that silently does nothing.
- The Android promo **banner** shows here (its message — the Android app is the
  one that actually nags — matters more on this host, not less); the title-bar
  **button** is hidden, because the flyout is a ~420px column and a permanent
  fixture costs real space.

Host-side, `AppFlyout.OnWebMessageReceived` ignores any message whose source is
not the app origin. Web content is not a privileged caller.

## Navigation containment

The flyout is not a browser, so:

- `NavigationStarting` cancels any top-level navigation off the app origin and
  hands the URL to the default browser. Landing on GitHub or a privacy policy
  inside a tray flyout is not useful.
- `NewWindowRequested` does the same for popups **except `accounts.google.com`**.
  Sign in with Google opens a popup that posts the credential back to its opener —
  which is exactly why the server sets
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` (`apps/api/src/app.ts`).
  Hand that popup to the default browser and the hand-back never happens, so
  Google sign-in fails silently. Leave it in-app.

## Light dismiss

`AppFlyout` implements dismissal itself rather than using
`OverlappedPresenter.CreateForContextMenu()`, because it hosts a full web app with
text entry and needs ordinary activation and keyboard focus.

The naive version — hide on any `Deactivated` — is wrong: focus moving *into* the
hosted WebView2 can surface as a top-level deactivation, which would close the
flyout the instant the user clicked into the page. So the handler re-checks on the
next dispatcher turn (by which point the foreground window has settled) and stays
open when `GetAncestor(GetForegroundWindow(), GA_ROOT)` is still the flyout.

A **pin** toggle (flyout header, mirrored in Settings) suppresses dismissal
entirely, because a flyout you are typing a reminder into should not vanish on a
stray click.

## The flyout is dark, opaque, and frameless

**Use `OverlappedPresenter.CreateForContextMenu()`, not `Create()`.** An
overlapped window always keeps a frame — stripping the border and title bar and
disabling resize shrinks it but never reaches zero. Measured on a 150%-scaled
display it left **3 physical pixels of non-client area on every edge**, which the
app cannot paint, so it read as a pale hairline around a dark window no matter
what the content did. A context-menu presenter is popup-based and has no frame,
which is what the sibling tray app uses for the same job.

That is also why **no `DWMWA_BORDER_COLOR` or `DWMWA_CAPTION_COLOR`** is set here
(only `DWMWA_WINDOW_CORNER_PREFERENCE`, plus `DWMWA_USE_IMMERSIVE_DARK_MODE` so
DWM's own shadow/antialiasing isn't derived from a light system theme). Those
attributes colour a frame; on a window that shouldn't have one they are at best
inert, and setting `DWMWA_BORDER_COLOR` to `COLOR_NONE` was actively worse — it
removed the fill and let the desktop show through the frame instead.

If a stray edge ever reappears, read the `flyout chrome:` line in
`%AppData%\Persistent\startup.log` before touching colours. It reports the
window rect against the client rect, and a non-zero `top`/`left`/`bottom` says
the pixels are non-client — i.e. not a colour problem at all. Four rounds went
into colour attributes before that measurement existed.

Two further things had produced a *band across the top* specifically, and are
worth keeping straight because fixing one did not fix the other:

- **`DesktopAcrylicBackdrop` follows the *system* theme.** On a light-mode
  desktop it renders light acrylic wherever content does not paint over it. The
  window frames a web app that is dark in every theme the PWA offers, so there is
  no backdrop at all now: the root grid paints an opaque `#0B0F19` and pins
  `RequestedTheme="Dark"` so the header glyphs stay light. `ThemeManager`
  deliberately skips this window — applying the user's light/system choice here
  would put light chrome back around dark content.
- **`ExtendsContentIntoTitleBar` + `SetTitleBar` on a window with no title bar.**
  Those are for a window that *has* a caption and wants to draw into it. Setting
  them while the presenter is `SetBorderAndTitleBar(false, false)` left WinUI
  reserving a caption strip and painting it the system caption colour. Don't set
  them here. The consequence is that the header is not a drag handle, which costs
  nothing for a flyout that is repositioned to the tray corner on every open.

The DWM border colour is also pinned (`DWMWA_BORDER_COLOR`), since the default
outlines a dark window in the system's light border.

## Storage

- `%AppData%\Persistent\settings.json` — host settings only (server URL, theme,
  startup, flyout geometry, pin). No credentials.
- `%AppData%\Persistent\WebView2\` — the WebView2 profile. This is what keeps the
  user signed in across restarts (the session cookie lives there, in the browser's
  own store) and what lets the service worker render offline. **Never point it at
  a temp folder.** "Clear saved sign-in" on the Connection page is
  `Profile.ClearBrowsingDataAsync()` — a local sign-out that touches nothing
  server-side.
- `%AppData%\Persistent\logs.*.txt` — NLog output.

## Building and releasing

The devcontainer is Linux and **cannot build or run any of this**; there is no
.NET or Windows SDK, and `npm run validate` does not cover C#. The CI workflow
`.github/workflows/build-desktop-msix.yml` compiles both platforms on
`windows-2025` for every push/PR touching `apps/desktop`, which is the only
automatic check that exists — treat a red run there the way you would a failed
`npm run validate`.

- Dev: `dotnet build Persistent.Desktop/Persistent.Desktop.csproj -c Debug`
- Icons: `.\Persistent.DesktopMSIX\generate-msix-images.ps1` (renders the same
  bell mark as `apps/web/public/favicon.svg`; keep the two in step)
**Start at sign-in works in the portable build**, via the unpackaged fallback in
`StartupManager`: no MSIX `windows.startupTask` exists, so it writes
`HKCU\…\Run` with this executable's absolute path. That path is the catch —
a portable build lives wherever it was unzipped, so a newer download in a new
folder would leave the entry aimed at the old copy. `RefreshRunKeyPath()` runs at
launch and re-points an *existing* entry at the running executable, so whichever
copy you last opened is the one that starts at sign-in.

- **Testing: `.\publish-portable.ps1`.** A self-contained unpackaged build —
  unzip and run `Persistent.Desktop.exe` on a clean Windows 11 machine with
  nothing installed first. `SelfContained` bundles .NET and
  `WindowsAppSDKSelfContained` bundles the Windows App SDK runtime; **both** are
  required, because without the second the app dies at startup with a
  missing-runtime error that reads like a crash. It is unsigned, so SmartScreen
  warns about an unknown publisher (the bundled `READ ME FIRST.txt` says so in
  plain language). Every CI run uploads this zip as an artifact for both
  architectures, so any commit can be tried without tagging a release.
- Package: `.\Persistent.DesktopMSIX\build-msix.ps1` (`-NoSign` for a Store
  upload). MSIX is for shipping, not testing — sideloading it means trusting a
  self-signed certificate first. It buys a real install, a Start menu entry and
  the `windows.startupTask` registration; unpackaged, "start at sign-in" falls
  back to the per-user `Run` key (`Classes/StartupManager.cs`), so that feature
  works either way.
- Release: bump `<Version>` in `apps/desktop/Directory.Build.props`, tag
  `desktop-vX.Y.Z`. The tag prefix keeps desktop releases from colliding with the
  Android `vX.Y.Z` tags in this same repo — which is also why `UpdateService`
  reads the release *list* and filters by prefix instead of calling
  `releases/latest`.

MSIX refuses to reinstall the same version with different content, so bump
`<Version>` for every packaged build.

## `EnableMsixTooling` is required for the unpackaged build too

`Persistent.Desktop.csproj` sets `<EnableMsixTooling>true</EnableMsixTooling>`
even though the app runs unpackaged (`WindowsPackageType=None`). The name is
misleading: it is what enables the PRI tooling that indexes the compiled XAML
(`.xbf`) into the app's own `resources.pri`.

Without it the build and publish both succeed — CI was green — and then the app
dies at runtime constructing its first window:

```
Microsoft.UI.Xaml.Markup.XamlParseException: XAML parsing failed.
   at Microsoft.UI.Xaml.Application.LoadComponent(...)
   at Persistent.Desktop.MainWindow.InitializeComponent()
```

The exception names no file and no line, and `MainWindow.xaml` is an empty
`<Grid/>`, so it reads like a XAML bug. It isn't: the published folder simply
contains no `resources.pri` at all (only the framework's `Microsoft.UI.*.pri`),
so `LoadComponent` cannot resolve *any* compiled XAML. If this ever recurs, check
for `resources.pri` beside the exe before looking at the markup.

## Residual risks

- **WebView2 runtime.** Evergreen ships with Windows 11, so this is a non-issue on
  the target. `AppFlyout` still shows an explanatory panel rather than an empty
  box if initialization fails.
- **Untested at runtime.** Everything here was authored in a Linux devcontainer
  and compiled only by CI. The focus/light-dismiss interaction and the Google
  sign-in popup path in particular want a real machine before they are trusted.
