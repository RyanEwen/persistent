# Desktop architecture (Windows tray app)

`apps/desktop` is a WinUI 3 tray app that shows the hosted Persistent PWA in a
flyout near the notification area. Read this before changing it, and read
[`alarm-architecture.md`](alarm-architecture.md) first for why the guarantees are
split the way they are.

## What it is, and what it deliberately is not

**It is a viewing and acting surface. It is not the persistence guarantee.**

The flyout hosts the real web app, so everything the web client can do works here
— sign in (including passkeys, see below), Done / Snooze / De-escalate, the
editor, checklists, history. What it does **not** do is guarantee you are told:
no alarm audio, no on-device scheduled alarms, nothing while the app is closed or
the machine is asleep. That still lives only in the Android client.

This is the honest description and the docs, the Connection page and the About
page all say it. A Windows app that *looked* like it would nag you, and then
didn't because the machine was asleep, would be worse than no Windows app.

**Optional Windows toasts are the one signal it offers** — off by default, per
machine, **transient**, and described in the settings copy as exactly what they
are. They alert as a reminder fires or escalates and then fade to the Action
Center; nothing here stays on screen, re-raises or demands dismissal. See
[Notifications](#notifications) below. Beyond them it is silent: the tray icon is
a plain mark. An earlier version badged it with a due count; that was dropped, and
with it the only reason the *page* had to keep running while hidden (see the
suspend note below) — which is why the toasts are raised by the host process from
its own connection rather than by the page.

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
- Opening is instant and lands the user on the screen they left, rather than
  re-loading the app on every tray click.

**Hidden, the WebView is suspended.** `SetWebViewIdle` collapses the control and
then calls `TrySuspendAsync` (order matters — it refuses while the controller is
visible), freezing JavaScript and timers and letting the renderer's memory be
reclaimed; `Resume` on show restores the page as it was. This is only affordable
because nothing outside the flyout consumes the page. While the tray icon carried
a due-count badge the `/ws` socket had to stay live to feed it, so the most that
could be done was stop rendering; removing the badge is what made real suspension
possible. The socket drops while suspended and the web client reconnects on
resume — the same path it already handles after a laptop sleeps.

The one thing suspension breaks is **staying current**. The page's service worker
is `autoUpdate`, but the browser only looks for a new one on a navigation and on a
~24h timer — and this WebView navigates once, at startup, then spends its life
frozen, so both triggers are gone. A tray app left running for a fortnight would
still serve the bundle it started with. So `SetWebViewIdle(false)` posts
`checkForUpdate` to the page on every resume (`lib/swUpdate.ts` acts on it, and
also listens for `visibilitychange`, which collapsing the controller is supposed to
drive — the message exists because that link cannot be verified outside Windows).
Tray -> **Reload** remains the manual lever, since it is a real navigation.

**Clicking the tray icon while the flyout is open closes it.** That needs a guard:
the click itself deactivates the flyout, so light dismiss has already hidden it by
the time the click message arrives, and a naive toggle would reopen the window the
user was dismissing. `Toggle` ignores a click landing within
`ReopenSuppressionMs` of a dismiss; `Show` (tray menu, second launch) is explicit
and never suppressed.

## The bridge (`apps/web/src/native/desktopBridge.ts`)

Three hosts now load **one** hosted bundle: browser, Capacitor/Android, and this
WebView2. None can be compiled in, so every difference is runtime feature
detection — the same rule that already governs `hasNativeUpdater()`.

- `isDesktopHost()` tests for `window.chrome.webview`. **Keep it distinct from
  `isNative()`**: Capacitor is absent here, so `isNative()` is false in the
  desktop host, and code that conflates the two silently misbehaves on one of
  them.
- `onHostMessage()` receives host→page messages: `back`, from the flyout's
  title-bar button, and `navigate` (below). The host does **not** call
  `CoreWebView2.GoBack()` —
  browser history is the trail of every hop the user made, which is the model the
  app deliberately rejected on Android. `performBack` (`useNativeBack.ts`) walks
  the screen hierarchy instead, shared with the Android gesture so the two cannot
  answer Back differently. Only the "ran out" case differs: Android leaves the
  app, the flyout closes via `requestClose()`.
- `hostSupportsPush()` is false on desktop, and **`SettingsPage` must actually
  call it** — it was written for this and left unimported, so the web
  "Browser notifications" card showed here and its button simply failed. Two
  independent things make the web path impossible on this host: WebView2 refuses
  `Notification.requestPermission()` unless the host handles `PermissionRequested`,
  and the page is suspended whenever the flyout is hidden, so even a granted
  subscription could only deliver while the flyout was already open. The Push API
  may still *report* as present, which is why a capability check alone is not
  enough.
- `navigate` (host -> page) carries an in-app path from a toast click. The host
  does not navigate the WebView itself, for the same reason it doesn't call
  `GoBack()`: reloading would throw away the user's place. The page validates the
  path is root-relative before acting on it — a host message is not a privileged
  caller either.
- `checkForUpdate` (host -> page) says the flyout was just resumed, so the page
  should look for a new build (`lib/swUpdate.ts`).
- `getHostSettings` / `setHostSettings` / `openHostSettings` (page -> host) and
  `hostSettings` (host -> page) are the tray app's own settings, shown on the
  page's Settings screen. See [Settings](#settings) below.
- `pageReady` (page -> host) says the page's host-message listener is attached.
  **`_webViewReady` is not that moment** — it is set as soon as the control is
  built, before the page has navigated, let alone mounted — so a `navigate` posted
  then is simply lost. The host holds the latest requested path and flushes it on
  `pageReady`, which is what makes a toast click during startup, and the settings
  window's "Open Persistent settings", land where they say they will.
- **Handle host messages with an explicit switch and a `default: return`.** Adding
  `checkForUpdate` to a handler that fell through to "treat it as Back" is what
  made the flyout close itself on every open — see the light-dismiss section.
- The Android promo **banner** shows here (its message — the Android app is the
  one that actually nags — matters more on this host, not less); the title-bar
  **button** is hidden, because the flyout is a ~420px column and a permanent
  fixture costs real space.

Host-side, `AppFlyout.OnWebMessageReceived` ignores any message whose source is
not the app origin. Web content is not a privileged caller.

## Settings

**There is one Settings screen, and it is the page's.** Windows notifications and
their default snooze, start-at-sign-in, the flyout size and the pin are all shown
by `apps/web/src/native/desktop-settings/`, alongside the theme, sounds and time
format the user already goes there for. They remain **host** settings in every
other respect: the host owns `settings.json`, applies them, and is the only writer.
The page renders what it is handed and posts back what the user changed.

The split is by which surface a setting describes, not by who stores it:

| Setting | Where | Why |
|---|---|---|
| Windows notifications, snooze default | Page | It is a notification setting, and the user is already on the notification screen |
| Start at sign-in, flyout size, pin | Page | They describe what the app does for the user |
| Server address, "Clear saved sign-in" | Native (`ConnectionPage`) | A control for the setting that decides whether the page loads is no use inside the page |
| Version, update check, log folder | Native (`AboutPage`) | Both are needed precisely when the page is not working |
| App theme | Native (`AppSettingsPage`) | It themes the native window, which the page cannot see |

Consequences worth knowing before changing this:

- **A patch is validated, never trusted** (`HostSettings.ApplyAsync`). The page is
  our own origin but still web content, and an unknown or out-of-range value is
  dropped rather than stored.
- **The host echoes the settings it holds after every write**, including after a
  failure, and the page treats that reply as authoritative over its own optimistic
  update. This is not ceremony: `RequestEnableAsync` can refuse a startup enable
  outright when the user has disabled the app in Task Manager, and without the echo
  the toggle would sit there claiming something Windows is not doing. **Start at
  sign-in is not stored at all** — it is asked of Windows on every send, because the
  user can change it from Task Manager and a stored copy would be a second answer
  that disagrees. (There was one, unread and unable to round-trip:
  `WhenWritingDefault` dropped a `false` from the file, which then read back as the
  `true` initializer.) `notifications` holds the same promise from the other end:
  `NotificationService.Sync` turns the setting back off when toast registration
  fails, so the echo cannot report notifications that could never arrive.
- **The snooze picker's options come from the host**, not from the web's
  `SNOOZE_PRESETS`. Windows allows a toast combo box five items and throws on the
  sixth, killing the whole toast, so `ToastNotifier` carries a five-item subset and
  is the only thing that knows that limit. A settings picker offering the full seven
  let the user choose two the notification could never start on, and
  `NearestChoice` then silently corrected them — with the shipped default of 10
  minutes being one of the two, so the setting read "10 min" while every toast
  opened on "5 min". Same argument as `flyoutSizes`: the host owns the list, the
  page renders it.
- **The page ships ahead of the host.** The bundle is hosted and updates itself,
  while the `.exe` may be an older portable build or a pending Store update. A host
  that does not answer `getHostSettings` simply never sends `hostSettings`, and the
  page renders no card at all. That silence *is* the version check; don't replace
  it with a hardcoded version compare.
- **The pin has two controls** (title bar and Settings), so each pushes to the
  other. It is the only setting that does.
- **Changing the size resizes the open flyout** (`ApplyFlyoutSize`). The control
  now lives inside the window it resizes, so deferring to the next open would look
  like it did nothing.
- **The size can also be dragged**, and then matches no preset, so the picker
  reports `custom` carrying the real dimensions rather than naming a preset the
  window does not match. Both halves of that label matter: Joy renders an Option's
  `label` prop once a value is picked, so putting the dimensions only in the list
  left "Custom" alone on the closed control, which is precisely the entry that has
  no meaningful name without them.
- **There is no settings cog in the flyout title bar.** A cog next to the page's
  own Settings tab, opening a second and differently-styled settings screen, is
  what this arrangement exists to remove. The native window is reachable from the
  tray menu, from "More Windows app settings" on the page, and from a **Settings
  button on the flyout's error panel** — that last one is not optional. Removing
  the cog otherwise left the failed-to-load state with no route to the server
  address, which is the setting whose entire justification for staying native is
  that you need it when the page will not load.

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

Two defensive measures sit alongside it, neither of which was the cause of the
flyout-vanishing bug below — read that first if you are debugging this again.

- `TakeForeground()` retries `SetForegroundWindow` while briefly attached to the
  foreground thread's input queue (`AttachThreadInput`). Windows' foreground lock
  only lets the foreground process call it, and a tray click leaves the *shell*
  foreground, so the plain call can return false — a `bool` the code used to
  ignore — and the window would open unfocused.
- `SettleMs` makes the flyout refuse to light-dismiss for the first half-second
  after opening, since showing, activating and taking the foreground is not atomic
  and a `Deactivated` can land mid-sequence.

The dismissal logs the foreground window and its root at `Debug`. A flyout that
closes when it shouldn't leaves no other trace, and that line separates "the user
clicked away" from "we never had focus at all".

### The flyout that closed itself (and why the pin didn't help)

Reported from a real machine: the flyout vanished the instant it opened, on every
click, and **turning the pin on changed nothing**. That last detail is the whole
diagnosis — the pin returns early from `OnActivated`, so if it doesn't help, the
close is not light dismiss at all.

It was `requestClose()`, from the page. `useNativeBack`'s host-message handler
ended in a bare fall-through:

```ts
if (message.type === 'navigate') { … return }
if (performBack(here, go) === 'exhausted') requestClose()
```

so *every* message that wasn't `navigate` was treated as a Back press. Adding
`checkForUpdate` — which the host posts on every resume — meant opening the flyout
ran Back, Back from the root screen is "exhausted", and the page asked the host to
close the window it had just opened.

The lesson is the shape, not the missing case: **host messages are handled by an
explicit switch with a `default: return`.** A channel whose unknown-message
behaviour is "close the window" will break again the next time one is added. Note
also that the fix shipped in the *web* bundle, so it reached every installed
desktop version without a new build.

### Every close is logged, because they look identical from outside

"It closes immediately" has several causes that are indistinguishable to the user,
and guessing between them cost two wrong fixes. `HideFlyout` now takes a reason and
logs it — at **Info**, since `NLog.config` floors the file target there and a
`Debug` line only ever reaches an attached debugger, which is no use on someone
else's machine. `%AppData%\Persistent\logs.*.txt` now names the culprit:
`light dismiss`, `tray click while open`, `page requested close`, or a deliberate
button. Keep it that way; add a reason with any new caller.

**The host ignores a `close` that arrives within `SettleMs` of opening.** This is
not paranoia: the stale-bundle case above wedged the app. The page asked to close
on every open, so it was never up long enough to fetch the fixed bundle — the
update mechanism (`checkForUpdate` on resume) was itself the trigger. A host that
refuses an instant close breaks that loop no matter what the page is running, which
matters because the page updates independently of the host and can always be older
than it.

Known closes the **pin does not guard**, because it only short-circuits light
dismiss:

- **A double-click on the tray icon.** Windows delivers LBUTTONUP, LBUTTONDBLCLK,
  LBUTTONUP, so the second "up" toggles closed the window the first one opened.
  `Toggle` now ignores a close within `SettleMs` of opening — the mirror of the
  `ReopenSuppressionMs` guard, which only covered hide-then-click.
- **`page requested close`**, above.

### Running the version you think you are

The portable build is a folder you unzip, so several copies can exist. A second
launch takes the single-instance mutex, posts "show the flyout" to the **already
running** instance and exits — so starting a newly downloaded copy while an old one
is running silently keeps you on the old binary. The About page reports the version
actually running; check it before concluding a desktop fix did nothing.

A **pin** toggle (flyout header, and on the page's Settings screen, each pushing to
the other) suppresses dismissal entirely, because a flyout you are typing a
reminder into should not vanish on a stray click. The header's **close button**
ignores the pin: pinning means "don't vanish when I click elsewhere", not "refuse
to shut".

**`SettleMs` defers the check, it does not skip it.** It used to return outright
during the grace window, which left the flyout stuck open for good: click away
inside the first half-second and the deactivation was dropped, and since the
window was already deactivated no second one was ever coming, so nothing re-asked.
The delay decides only *when* to look; `CheckLightDismiss`'s foreground test is
what answers, and it is just as correct late as early.

## The flyout is dark, opaque, and frameless

**Use `OverlappedPresenter.CreateForContextMenu()`, not `Create()`.** An
overlapped window always keeps a frame — stripping the border and title bar and
disabling resize shrinks it but never reaches zero. Measured on a 150%-scaled
display it left **3 physical pixels of non-client area on every edge**, which the
app cannot paint, so it read as a pale hairline around a dark window no matter
what the content did. A context-menu presenter is popup-based and has no frame,
which is what the sibling tray app uses for the same job.

**Do not set `IsResizable = true` on it either.** It is *accepted* (no exception,
and it reads back `true`), so this looks like a free way to get drag-to-resize.
Measured on the same 150%-scaled display it brings the frame straight back:
`non-client top=10 left=10 bottom=10` against `0/0/0` for a fixed presenter, and
the client area drops from 690x1230 to 670x1210. That is worse than the 3px an
overlapped presenter costs, and it shows as a grey band above the header, because
the app is not allowed to paint there. **Drag-to-resize is done by hand instead**
(`Controls/ResizeGrip.cs` plus the grip handlers in `AppFlyout.xaml.cs`):
transparent strips on the top and left edges that capture the pointer and drive
`AppWindow.MoveAndResize`. Only those two edges, because the flyout is anchored to
the tray corner and grows up and to the left. Screen coordinates come from
`GetCursorPos`, not the pointer event, since the window moves out from under the
cursor mid-drag and an element-relative position measures against a frame of
reference that is itself moving.

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

## Notifications

**Off by default, per machine, and not the persistence guarantee.** The setting is
on the page's Settings screen ([Settings](#settings)), and its copy says plainly
that it only works while the PC is awake with Persistent running, never rings an
alarm and never wakes the machine.

`Persistent.Desktop/Notifications/` is the whole feature:

| File | Role |
|---|---|
| `RealtimeClient.cs` | The host's own `/ws` connection; flattens events to ids + text |
| `ToastNotifier.cs` | Builds, replaces and removes `AppNotification` toasts |
| `OccurrenceApi.cs` | The only two domain calls: `ack` and `snooze` |
| `NotificationService.cs` | Wires those together and owns the lifecycle |

**Why the host connects to `/ws` instead of letting the page do it.** The page has
its own socket, but the WebView is suspended whenever the flyout is hidden, which
freezes its JavaScript and drops that socket. A notification that could only
arrive while the flyout was already open is useless. A host-owned connection means
the suspend optimization above survives untouched — do not undo it to make the
page's notifications work, because the page's notifications cannot work here
anyway (see `hostSupportsPush()`).

**The snooze durations are duplicated on purpose.** `ToastNotifier.SnoozeChoices`
mirrors `SNOOZE_PRESETS` in `apps/web/src/lib/durations.ts`. That is a list of
durations, not a rule — it cannot disagree with the server about anything — so it
does not fall under the no-duplicated-contract rule the way a status rule or
`reminderBodyText` would. Change one, change the other.

**Auth is borrowed, never stored.** `AppFlyout.GetSessionCookieAsync()` reads the
session cookie out of the WebView2 profile per call. Nothing is cached and nothing
is written to `settings.json`, so a refreshed session is picked up automatically
and signing out simply makes every call fail. `/ws` authenticates from that cookie
on the HTTP upgrade, exactly as a browser would.

**What it is allowed to know.** Five fields off an occurrence event: id, reminder
id, status, title, `details`. Deliberately *not* the medication doses or the
checklist — rendering those is `reminderBodyText` in `@persistent/shared`, and a
C# copy of it is precisely the drift this app's design rejects. A medication toast
therefore shows the title alone, and the doses are one click away in the flyout.
If that ever needs to change, the fix is for the **server** to render the body
into the event, not for the host to learn the rules.

**The toasts are transient, deliberately.** No `AppNotificationScenario` is set,
so they alert and then fade into the Action Center like any ordinary Windows
notification. `Reminder` and `Urgent` both pin a toast on screen until it is
dismissed, which is nagging — and this surface does not nag. Windows gets an
alert when a reminder fires or escalates, and nothing more. Anything that
re-raises, re-sounds or refuses to go away belongs on Android, which is the only
client that can actually guarantee it.

A toast that fails to build shows nothing at all, and the failure is one
`Logger.Warn` deep in a background handler — easy to ship and never notice. That
is not hypothetical: the snooze picker was created with **seven** items when
Windows caps a toast combo box at **five**, so `AddItem` threw on the sixth,
every toast build failed, and notifications appeared completely dead while the
socket, the registration and the settings were all fine. See `MaxComboItems` in
`ToastNotifier.cs`; the list is truncated defensively so the same mistake costs a
short picker rather than the feature.

**The contract obligations it does carry**, from
[`notification-behavior.md`](notification-behavior.md):

- **One toast per occurrence** (§4), tagged by occurrence id. Tagging by reminder
  would let a 13:00 dose replace an unconfirmed 09:00 one in the Action Center —
  the self-collapse the app exists to reject.
- **Done is a two-tap confirm** (§1). A toast button cannot ask a question, so the
  first Done re-shows the *same tag* as a "Mark this done?" variant with Confirm /
  Not yet; only Confirm acks. Windows replaces a toast sharing a tag and group, so
  it reads as the buttons changing in place.
- **A server `dismiss` clears the toast**, so confirming on the phone clears it
  here (`data-event-contract.md`).
- **Silence is deliberately absent.** It drops an escalation back to an ordinary
  notification; there is no alarm on this surface to drop.
- **A failed action leaves the toast up.** The occurrence is still unconfirmed, and
  clearing it would claim something was done that wasn't.

**Registration has a visible side effect.** `AppNotificationManager.Register()`
creates a Start-menu shortcut when unpackaged — that is how Windows attributes a
toast to an app — so it runs only once the user has turned notifications on, not
at every startup. Packaged builds need the `windows.toastNotificationActivation`
and `windows.comServer` entries in `Package.appxmanifest` instead; without them
the toasts appear and then do nothing when clicked. **The activator CLSID in that
manifest must never change** — it is how Windows routes a click on a toast already
sitting in the Action Center back to this app.

## Storage

- `%AppData%\Persistent\settings.json` — host settings only (server URL, theme,
  flyout geometry, pin, notification toggle + snooze default). No credentials, and
  **no start-at-sign-in** — Windows owns that one, and it is read from the OS.
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
- **MSIX packaging is the least-proven path here, and CI no longer lets it block a
  release.** It only runs on a `desktop-v*` tag, so nothing exercises it until the
  moment it matters — and the first tag ever cut (`desktop-v0.2.0`) failed on it
  while the portable build was fine. The cause: `build-msix.ps1` passed
  `-p:WindowsPackageType=MSIX`, which the SDK rejects unless the *project* declares
  an `<AppxManifest>` item
  (`Microsoft.Windows.SDK.BuildTools.MSIX.Packaging.targets`, whose error message
  reads backwards). This script packages **externally** — publish a plain layout,
  write the manifest into it, then `makeappx` — so the project must stay unpackaged
  during publish and that flag never belonged. The step is now
  `continue-on-error`: a packaging failure costs the `.msix` asset, not the whole
  release, and the portable zip always ships.
- **The release job's `files:` globs must be recursive.** `upload-artifact` roots
  each artifact at the least common ancestor of its paths — `apps/desktop` here —
  so the assets come back one level down (`release/*.zip`,
  `Persistent.DesktopMSIX/*.msix`) and a flat `artifacts/*.zip` matches nothing.
  That is not hypothetical: `desktop-v0.2.0` first published with **zero assets**
  while the job reported success, because `action-gh-release` only warns on an
  unmatched pattern. `fail_on_unmatched_files: true` now makes that fatal — an
  empty release is worse than a failed run, since the in-app update check would
  offer it.
- Package: `.\Persistent.DesktopMSIX\build-msix.ps1` (`-Store` for a Store
  upload, `-Upload` for both architectures at once). MSIX is for shipping, not
  testing — sideloading it means trusting a self-signed certificate first. It buys
  a real install, a Start menu entry and the `windows.startupTask` registration;
  unpackaged, "start at sign-in" falls back to the per-user `Run` key
  (`Classes/StartupManager.cs`), so that feature works either way.
- Release: bump `<Version>` in `apps/desktop/Directory.Build.props`, tag
  `desktop-vX.Y.Z`. The tag prefix keeps desktop releases from colliding with the
  Android `vX.Y.Z` tags in this same repo — which is also why `UpdateService`
  reads the release *list* and filters by prefix instead of calling
  `releases/latest`.
- **Desktop releases pin `make_latest: false`** (and the Android workflow pins
  `true`). The two series interleave by date, so GitHub's default gave "Latest" to
  whichever shipped most recently — which is how `desktop-v0.2.3` came to answer
  `/releases/latest`. That endpoint is the Android updater's source
  (`apps/api/src/routes/app-release.ts`) and a desktop release carries no `.apk`,
  so it returned "no update" to every Android client until the next app release.
  `UpdateService` is unaffected either way, but don't drop the pin to "simplify".

MSIX refuses to reinstall the same version with different content, so bump
`<Version>` for every packaged build.

## The Microsoft Store

The app ships on the Store as product **9PCX2XGQ7CJS**, published by
TechnicallyReal alongside the sibling WinUI apps (Repilot, Little Launcher,
ImmichDrive). Everything here follows what those three already do; where this one
differs, it says why.

**Identity is not a detail.** `Package.appxmanifest` carries the real Partner
Center values, and the Store rejects a package that differs from them by a
character:

| Field | Value |
|---|---|
| `Identity/Name` | `27766TechnicallyReal.Persistent` |
| `Identity/Publisher` | `CN=C21E6CEF-D0D1-4497-93F9-3718D054DA0E` |
| `Properties/PublisherDisplayName` | `TechnicallyReal` |
| Package family name | `27766TechnicallyReal.Persistent_gfb69tsnc4jnp` |

**`build-msix.ps1` has two modes, and they differ in identity, not just signing.**

- Default (**sideload**): rewrites `Name` to `Persistent.Desktop` and `Publisher`
  to the dev certificate's subject, then signs. Both attributes have to move
  together — the package family name is a hash of the pair, and Windows refuses to
  install a package whose declared `Publisher` is not the subject of the
  certificate that signed it. The rewrite goes through the XML DOM rather than a
  `-replace`, because `Name="..."` also appears on `TargetDeviceFamily` and on
  every `Capability`.
- `-Store`: leaves the Partner Center identity alone and does not sign at all. The
  Store re-signs at ingestion, so any signature applied here is discarded.
- `-Upload`: implies `-Store`, builds x64 and ARM64, and emits **both** the loose
  per-architecture `.msix` files *and* a `.msixupload` container. That is not
  redundancy: the Partner Center web UI wants the loose files (the container does
  not upload reliably through it), and `msstore publish` wants the container.

**Two things the packaged build needs that `dotnet publish` will not do for you.**
Both were found by installing a package for the first time on 2026-08-19; until
then every MSIX this repo had ever produced started and exited in under a second,
and CI could not tell because its packaging step is `continue-on-error` and nobody
installed the artifact.

- **Compiled XAML (`.xbf`) has to be copied into the layout by hand.** `dotnet
  publish` emits it into the RID *build* directory and leaves it out of the
  publish output. Without it the process dies in the `App` constructor, where
  `InitializeComponent` cannot find its markup — which is before `OnLaunched`, so
  before NLog and before `StartupDiagnostics`. The symptom is nothing at all: no
  dialog, no Application event, no `startup.log`, just an AppX container created
  and destroyed in the same second. `build-msix.ps1` now throws if it finds no
  `.xbf` to copy, because a silent version of this bug already cost one release.
- **The Windows App SDK auto-initializer has to be suppressed**
  (`-p:WindowsAppSdkBootstrapInitialize=false`). The project is
  `WindowsPackageType=None`, which injects a bootstrapper whose job is locating the
  framework for an *unpackaged* process; a packaged app must not run it. The
  sibling apps suppress it by publishing with `WindowsPackageType=MSIX`, which is
  not available here — `EnableMsixTooling` is on, and that makes the SDK demand an
  `<AppxManifest>` item the project deliberately does not have.

**The packaged build declares a dependency on the Windows App Runtime**, unlike
the portable build which carries its own copy. `build-msix.ps1` publishes with
`SelfContained` but not `WindowsAppSDKSelfContained`, so without the
`<PackageDependency>` on `Microsoft.WindowsAppRuntime.1.8` the app installs
cleanly and then dies at startup on any machine that has never had it. Keep its
`MinVersion` in step with the `Microsoft.WindowsAppSDK` package reference.

**The first submission is manual, and only the first.** Microsoft's prerequisites
for the CLI and the GitHub Action state that "the app you want to update must
already be published and live in Microsoft Store" — the tooling updates an
existing product's package, and cannot supply the age rating, pricing and
availability, or properties that a never-published product needs before
certification will accept it. So version one goes up by hand:

1. `.\Persistent.DesktopMSIX\build-msix.ps1 -Upload`
2. Upload the two per-architecture `.msix` files in the Partner Center UI — **not**
   the `.msixupload`, which does not upload reliably through the web form.
3. Complete the listing, age rating, and pricing/availability, submit, and wait for
   it to go live.

**Updates after that are automated** by `.github/workflows/store-publish.yml`
(manual dispatch, `draft` by default). This is the one TechnicallyReal app where
that works: the `msstore` CLI supports **free** products only, and the paid
siblings fall back to a manual upload every time. If Persistent ever gains a
price, the workflow stops working and the fallback is dragging the two `.msix`
files into Partner Center.
It needs four repository secrets — `AZURE_AD_TENANT_ID`,
`AZURE_AD_APPLICATION_CLIENT_ID`, `AZURE_AD_APPLICATION_SECRET`, `SELLER_ID` —
plus `SUBMODULES_TOKEN` for the checkout. **Set them with
`apps/desktop/set-ci-secrets.sh`**, run from the devcontainer (`gh` is already
authenticated there), which prompts with echo off and pipes each value to
`gh secret set` over stdin.

`SUBMODULES_TOKEN` is **one PAT shared by four repos** — this one plus Little
Launcher, Repilot and ImmichDrive, which all check out the same submodule. So
regenerating it is a fleet-wide operation, and any repo missed starts failing at
checkout rather than at a step that names the token:

```
./apps/desktop/set-ci-secrets.sh --all --only SUBMODULES_TOKEN
```

`--all` prompts once and writes to every consumer, which is the point: pasting a
PAT four times is how one of the four ends up with a typo. The repo list in the
script was built by checking which repos hold the secret, not by code search —
GitHub's code search under-indexes `.gitmodules` and silently missed one.

**The client secret expires, and nothing will tell you.** Entra credentials last
24 months at most, and there is no call that answers "when does mine expire?" —
reading an app registration's own `passwordCredentials` needs Graph permissions
the Store credential does not have and should not be given. So `set-ci-secrets.sh`
prompts for the date when it sets the secret and records it as the
`STORE_SECRET_EXPIRES` repository *variable*; `store-secret-expiry.yml` checks it
weekly and fails the run from 60 days out, and `store-publish.yml` warns on it in
passing. The two cannot drift, because rotating the secret is what updates the
date. It is a variable rather than a secret deliberately: an expiry date is not
sensitive and the warning has to be able to print it.

That workflow does not open an issue on purpose. A failed scheduled run already
emails the owner, and this repository is public — an issue stating exactly when
the publishing credential lapses is free reconnaissance for anyone watching.

Note for anyone porting that script back to a sibling repo: `gh secret set` reads
stdin only when `--body` is **absent**. `--body -` does not mean "read stdin" — it
stores a literal hyphen and silently discards the pipe.

The names match Little Launcher's rather than describing this workflow, because
the same Entra app registration and seller account back every TechnicallyReal app
— a rotation is then the same four values in every repo. They cannot be copied
between repos programmatically: GitHub returns secret *names* only, never values,
and the script deliberately never writes them to disk.

The Entra app registration behind them must be added under Partner Center →
Account settings → User management → Microsoft Entra applications with the
**Manager** role. Without that role authentication succeeds and submission is
refused, which is the single most missed step.

**Updating splits by install type** (`Services/UpdateService.cs`). Unpackaged
copies check GitHub Releases and get a link; packaged copies go through
`StoreContext`, which installs in place. Offering a GitHub download beside a Store
install is the alternative update mechanism Store policy exists to stop. Two traps
in that code are load-bearing and documented at the call site: a listed
`StorePackageUpdate` reports the version *already installed*, so requiring it to be
newer means never offering an update at all; and download and install must be two
separate calls, or a tray app that never exits hides the download behind a wait
that cannot resolve.

## The `external/promo` submodule

`apps/desktop/external/promo` is a private git submodule
(`RyanEwen/technicallyreal-promo`) shared with the sibling Store apps. It supplies
the settings window's "Our other apps" page as a shared-items project imported by
`Persistent.Desktop.csproj`, and hides whichever app it is running inside by
package family name.

It never touches the network: names, blurbs and icons are fetched from the Store
by the submodule's own `refresh.ps1` on a dev machine and committed as static
assets; clicking a card hands a `ms-windows-store://` URI to the Store app. Both
CI workflows check out with `submodules: true` and a `SUBMODULES_TOKEN` PAT,
because the csproj imports it unconditionally — a checkout without it does not
compile, which is deliberate: guarding the import with `Exists()` would move the
failure to a confusing "the namespace 'Promo' does not exist".

Once Persistent is live, add `9PCX2XGQ7CJS` to the submodule's `ids.json`, run
`refresh.ps1`, and bump the submodule pointer in all four apps so the other three
promote it too.

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
- **A failed toast registration now turns the setting off.** `NotificationService.Sync`
  corrects `DesktopNotifications` when `Enable()` cannot register, so the toggle
  never reads "on" while nothing can be delivered. That write re-enters `Sync`
  through the property's own change side-effect; it terminates because the second
  pass reads the value just written and takes the `Disable` branch. The breadcrumb
  is still in startup.log ("notifications: toast registration FAILED").
