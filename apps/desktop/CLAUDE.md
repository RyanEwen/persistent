# Desktop conventions (`apps/desktop`)

WinUI 3 (Windows App SDK) tray app that hosts the Persistent PWA in a WebView2
flyout. Architecture, and the reasoning behind the WebView decision, live in
[`docs/desktop-architecture.md`](../../docs/desktop-architecture.md) — read that
first.

**This is C#, so `npm run validate` does not cover it and the Linux devcontainer
cannot build or run it.** The only automatic check is
`.github/workflows/build-desktop-msix.yml`, which compiles both platforms on
`windows-2025` for every push/PR under this directory. Treat a red run there the
way you would a failed `npm run validate`.

## The rule that keeps this app small

**Anything that belongs to a reminder belongs in the PWA, not here.** The host
owns windows, the tray, and which server to load — nothing else. If you find
yourself adding a C# model of a reminder, a REST call for domain data, or a
second implementation of a done/snooze rule, stop: that is the mistake this design
exists to avoid (see `docs/notification-behavior.md` — every surface must
converge, and the surface that *is* the web client cannot diverge).

Concretely, do not add: DTO mirrors of `@persistent/shared`, an HTTP client for
`/api/reminders` or `/api/occurrences`, native reminder UI, or native
notifications. The app deliberately shows no OS notifications at all.

## Layout

| Path | Role |
|---|---|
| `Directory.Build.props` | `<Version>` — single source of truth; platform auto-detect |
| `Persistent.Desktop/App.xaml.cs` | Entry point; single-instance mutex; NLog wiring |
| `Persistent.Desktop/MainWindow.xaml.cs` | Invisible tool window: tray icon, menu, app lifetime |
| `Persistent.Desktop/Windows/AppFlyout.xaml.cs` | The flyout + the warm WebView2 (the actual product) |
| `Persistent.Desktop/SettingsWindow.xaml.cs` | On-demand `NavigationView` + `Frame` |
| `Persistent.Desktop/Pages/` | `ConnectionPage`, `AppSettingsPage` (the nav cog), `AboutPage` |
| `Persistent.Desktop/Classes/NativeMethods.cs` | **All** Win32 P/Invoke |
| `Persistent.Desktop/Classes/TrayIconRenderer.cs` | Badge composition (`System.Drawing`) |
| `Persistent.Desktop/Services/TrayState.cs` | Badge state, fed by the web bridge |
| `publish-portable.ps1` | Self-contained unpackaged build (**the one to use for testing**) |
| `Persistent.DesktopMSIX/` | Manifest + `build-msix.ps1` + `generate-msix-images.ps1` (for shipping) |

## Conventions

- **The WebView is created once, at startup, and shown/hidden — never rebuilt.**
  The page's `/ws` socket is what feeds the tray badge, so a torn-down WebView
  means a badge that is only correct while you are looking at it. Anything that
  would dispose it needs to justify that first.
- **Settings**: one `[ObservableProperty]` partial property per setting on
  `UserSettings`, PascalCase, with a sensible default; side-effects go in a
  partial `On<Name>Changed` guarded by `if (_initializing) return;`.
  `SettingsManager` serializes to `%AppData%\Persistent\settings.json`. Keep this
  file free of credentials — the session lives in the WebView2 profile.
- **P/Invoke** lives only in `Classes/NativeMethods.cs`, grouped by DLL with a
  header comment. Prefer `[LibraryImport]` for new declarations (the class must
  then be `partial`). Always `DestroyIcon` an HICON you create.
- **Icons**: load a generous frame (32 for the tray/small slot, 64 for
  `AppWindow.SetIcon`), never 16 — the shell downscaling stays crisp, upscaling
  does not. In-app XAML `Image` sources use the high-res PNG, not the `.ico`.
- **PowerShell build scripts must be ASCII.** Windows PowerShell 5.1 reads a
  BOM-less `.ps1` as ANSI, so a UTF-8 dash or curly quote inside a string breaks
  parsing in ways that are hard to spot.
- **Failure paths get an NLog line, not a silent `catch`** — the same rule as the
  API. A swallowed exception here costs the user their only ambient signal. Keep a
  bare `catch` only for genuinely cosmetic things (a missing icon file), and say
  so in a comment.
- `global::` does not parse inside interpolated strings — assign to a local first.
  Fully-qualify `Microsoft.UI.Xaml.Visibility` / `FocusState` in page code-behind.
- Bump `<Version>` in `Directory.Build.props` for every packaged build; MSIX
  refuses to reinstall the same version with different content.

## Changing the web side too

Host behavior that depends on the page lives in
`apps/web/src/native/desktopBridge.ts`. All three hosts load the **same** hosted
bundle, so it is runtime feature detection, never a build flag — and
`isDesktopHost()` must stay distinct from `isNative()` (Capacitor is absent here,
so `isNative()` is false in this host).
