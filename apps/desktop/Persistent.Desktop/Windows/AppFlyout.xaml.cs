using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Persistent.Desktop.Classes.Settings;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using WinRT.Interop;
using static Persistent.Desktop.Classes.NativeMethods;

namespace Persistent.Desktop.Windows;

/// <summary>
/// The flyout: a borderless window near the tray that hosts the real Persistent
/// PWA in a WebView2.
///
/// It is created ONCE at startup and shown/hidden thereafter — never rebuilt per
/// open — so opening is instant and lands the user where they left off. A cold
/// WebView2 plus a page load is a visible pause on every tray click.
///
/// Because the hosted page is the same bundle the web and Android clients run, the
/// user gets sign-in (including passkeys via Windows Hello, which the Android
/// WebView cannot do), Done/Snooze/De-escalate and the editor with no native
/// reimplementation — and no way for this surface to drift from
/// docs/notification-behavior.md.
///
/// It still does NOT provide the persistence guarantee: no alarm audio, no
/// on-device scheduling, nothing while the machine sleeps. Optional Windows toasts
/// (<see cref="Notifications.NotificationService"/>, off by default) are raised by
/// the host from its own `/ws` connection, not by this page — the WebView is
/// suspended while the flyout is hidden, so nothing in here can be relied on to
/// deliver anything. See docs/desktop-architecture.md.
/// </summary>
public sealed partial class AppFlyout : Window
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private static AppFlyout? _instance;

    private readonly IntPtr _hwnd;
    private readonly AppWindow _appWindow;
    private bool _webViewReady;
    private bool _visible;

    /// <summary>The page is suspended while hidden; see <see cref="SetWebViewIdle"/>.</summary>
    private bool _suspended;

    /// <summary>
    /// Set when the page announces itself (`pageReady`), meaning its host-message
    /// listener is attached and a posted message will be acted on. Distinct from
    /// <see cref="_webViewReady"/>, which only says the control exists. Reset on
    /// every navigation, since a reload starts a page that has not subscribed yet.
    /// </summary>
    private bool _pageListening;

    /// <summary>A screen requested before the page was listening; see <see cref="NavigateTo"/>.</summary>
    private string? _pendingPath;

    /// <summary>When the flyout was last hidden, for the tray-click toggle below.</summary>
    private long _hiddenAtTicks;

    /// <summary>When it was last shown; see <see cref="SettleMs"/>.</summary>
    private long _shownAtTicks;

    /// <summary>
    /// How long after opening the flyout refuses to light-dismiss.
    ///
    /// Activation does not settle instantly — the window is shown, activated and
    /// then asked for the foreground, and Windows can deliver a Deactivated in the
    /// middle of that. Without this grace the flyout answers that transient by
    /// closing itself, which is a flyout that vanishes the instant it appears and
    /// cannot be used at all. Nobody clicks away inside this window, so the only
    /// dismissal it can swallow is one the user did not mean.
    /// </summary>
    private const long SettleMs = 500;

    /// <summary>How long after a dismiss a tray click still counts as part of it.
    /// Long enough to cover the gap between losing focus and the click arriving,
    /// short enough that a deliberate second click still opens the flyout.</summary>
    private const long ReopenSuppressionMs = 500;

    public static AppFlyout? GetCurrent() => _instance;

    /// <summary>Build the flyout and start loading the page, without showing it.</summary>
    public static void EnsureCreated()
    {
        if (_instance != null) return;
        _instance = new AppFlyout();
    }

    public static void Show()
    {
        EnsureCreated();
        _instance?.ShowNearTray();
    }

    public static void Hide()
    {
        if (_instance is { _visible: true }) _instance.HideFlyout("Hide() called");
    }

    /// <summary>
    /// Tray left-click: open if closed, close if open.
    ///
    /// The subtlety is that clicking the tray icon *while the flyout is open*
    /// deactivates it, so light dismiss has already hidden it by the time the click
    /// message arrives — `_visible` reads false and a naive toggle would reopen the
    /// window the user was trying to dismiss. So a click landing immediately after a
    /// dismiss is treated as the closing half of that same gesture and does nothing.
    ///
    /// Only <see cref="Toggle"/> suppresses. <see cref="Show"/> — the tray menu, a
    /// second launch — is an explicit request and always opens.
    /// </summary>
    public static void Toggle()
    {
        EnsureCreated();
        if (_instance == null) return;

        if (_instance._visible)
        {
            // A DOUBLE-click on the tray icon delivers LBUTTONUP, LBUTTONDBLCLK,
            // LBUTTONUP — so the second "up" toggles closed the window the first one
            // just opened, and the flyout appears and vanishes. `ReopenSuppressionMs`
            // below guards the mirror case (hide, then click) but not this one.
            // Nobody deliberately closes a flyout within half a second of opening it.
            if (Environment.TickCount64 - _instance._shownAtTicks < SettleMs) return;
            _instance.HideFlyout("tray click while open");
            return;
        }

        if (Environment.TickCount64 - _instance._hiddenAtTicks < ReopenSuppressionMs)
        {
            // Light dismiss already closed it as part of this same click. Clear the
            // stamp so the next click opens normally rather than being swallowed too.
            _instance._hiddenAtTicks = 0;
            return;
        }

        _instance.ShowNearTray();
    }

    public static void Reload() => _instance?.NavigateToApp();

    /// <summary>
    /// Re-read the pin setting after the page changed it. The pin is the one
    /// setting with two controls (this title-bar toggle and the one on the page's
    /// Settings screen), so each has to answer the other, or the flyout ends up
    /// showing a pin state it is not honoring.
    /// </summary>
    private void SyncPinState() => PinButton.IsChecked = SettingsManager.Current.PinFlyout;

    /// <summary>
    /// Forget this PC's session: clears the WebView2 profile (cookies, storage, the
    /// service-worker cache) and reloads, which lands the user back on sign-in.
    /// Nothing server-side is touched — this is a local sign-out, not an account
    /// action. Returns false when the WebView isn't up yet and there is nothing to
    /// clear, so the caller can say so rather than claiming success.
    /// </summary>
    public static async Task<bool> ClearBrowsingDataAsync()
    {
        var instance = _instance;
        if (instance is not { _webViewReady: true }) return false;
        try
        {
            await instance.WebView.CoreWebView2.Profile.ClearBrowsingDataAsync();
            instance.NavigateToApp();
            return true;
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not clear the WebView2 profile");
            return false;
        }
    }

    /// <summary>Really close it — only on app exit.</summary>
    public static void CloseForExit()
    {
        var instance = _instance;
        _instance = null;
        instance?.Close();
    }

    /// <summary>
    /// The session cookie for the app origin, formatted as a `Cookie:` header, or
    /// null when the WebView isn't up or the user is signed out.
    ///
    /// <para>This is how the optional toast feature authenticates without holding a
    /// credential of its own: the session lives in the WebView2 profile — the
    /// browser's own store — and is borrowed per call, so a refreshed session is
    /// picked up automatically and a sign-out simply makes this return null. Never
    /// cache the result; that would outlive the session it came from.</para>
    ///
    /// <para>CookieManager is apartment-bound, so this hops to the flyout's UI
    /// thread and back regardless of which thread asks.</para>
    /// </summary>
    public static Task<string?> GetSessionCookieAsync()
    {
        var instance = _instance;
        if (instance is not { _webViewReady: true }) return Task.FromResult<string?>(null);

        var completion = new TaskCompletionSource<string?>();
        bool queued = instance.DispatcherQueue.TryEnqueue(async () =>
        {
            try
            {
                var cookies = await instance.WebView.CoreWebView2.CookieManager
                    .GetCookiesAsync(SettingsManager.Current.EffectiveServerUrl);
                var header = string.Join("; ", cookies.Select(c => $"{c.Name}={c.Value}"));
                completion.TrySetResult(header.Length == 0 ? null : header);
            }
            catch (Exception ex)
            {
                Logger.Warn(ex, "Could not read the session cookie from the WebView2 profile");
                completion.TrySetResult(null);
            }
        });
        if (!queued) completion.TrySetResult(null);
        return completion.Task;
    }

    /// <summary>
    /// Open the flyout on one reminder's detail view — where a toast body click
    /// lands.
    ///
    /// <para>Sent as a page message rather than a navigation: the host does not own
    /// the app's routes, and re-navigating the WebView would throw away the page
    /// state and the user's place in it. The page decides what the path means
    /// (`apps/web/src/native/desktopBridge.ts`), the same way it already owns Back.</para>
    /// </summary>
    public static void NavigateToReminder(string reminderId) =>
        // Ids are server-minted cuids, but this string ends up inside JSON that the
        // page will act on, so it is escaped rather than trusted.
        NavigateTo("/reminders/" + Uri.EscapeDataString(reminderId));

    /// <summary>
    /// Ask the page to show one of its own screens.
    ///
    /// Held until the page says it is listening, rather than posted and lost.
    /// `_webViewReady` is not that moment: it is set the instant the control is
    /// built, before the page has even navigated, let alone mounted and subscribed.
    /// Both callers are explicit user requests — a toast click, and the settings
    /// window's "Open Persistent settings" — and a message posted into a page with
    /// no listener leaves the user on whatever screen they were last on, with
    /// nothing to say the button did anything. Only the latest is kept: two requests
    /// inside that window still mean one destination.
    /// </summary>
    public static void NavigateTo(string path)
    {
        var instance = _instance;
        if (instance == null) return;
        if (!instance._pageListening)
        {
            instance._pendingPath = path;
            return;
        }
        instance.DispatcherQueue.TryEnqueue(() => instance.PostNavigate(path));
    }

    private void PostNavigate(string path)
    {
        if (!_webViewReady) return;
        try
        {
            WebView.CoreWebView2.PostWebMessageAsJson(
                JsonSerializer.Serialize(new { type = "navigate", path }));
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not ask the page to open {0}", path);
        }
    }

    private AppFlyout()
    {
        InitializeComponent();

        _hwnd = WindowNative.GetWindowHandle(this);
        _appWindow = AppWindow.GetFromWindowId(Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_hwnd));
        _appWindow.IsShownInSwitchers = false;

        // A CONTEXT-MENU presenter, not OverlappedPresenter.Create().
        //
        // This matters and cost several rounds to pin down. An overlapped window
        // always keeps a frame: stripping the border and title bar and disabling
        // resize shrinks it but never reaches zero. Measured on a 150%-scaled
        // display it left 3 physical pixels of non-client area on *every* edge —
        // area the app cannot paint, so it showed as a pale hairline whatever
        // colour the content was. No DWM colour attribute fixes that, because the
        // region is not ours to colour; setting DWMWA_BORDER_COLOR to COLOR_NONE
        // actively made it worse by removing the fill and letting the desktop show
        // through.
        //
        // A context-menu presenter is popup-based and has no frame at all, which is
        // what the sibling tray app (ImmichDrive) uses for the same job. Light
        // dismiss is still implemented by hand below rather than inherited, because
        // this window hosts a web app with text entry and must keep ordinary
        // activation and keyboard focus.
        var presenter = OverlappedPresenter.CreateForContextMenu();
        presenter.SetBorderAndTitleBar(false, false);
        presenter.IsAlwaysOnTop = true;
        _appWindow.SetPresenter(presenter);

        // NO ExtendsContentIntoTitleBar / SetTitleBar here, deliberately.
        //
        // Those are for a window that HAS a title bar and wants to draw its own
        // content into it. This window asked the presenter for none at all, and
        // setting both anyway left WinUI reserving a caption strip it then painted
        // with the system caption colour: a full-width white band across the top on
        // a light-mode desktop. Removing the acrylic backdrop did not touch it,
        // because the strip was never the backdrop.
        //
        // The cost is that the header is no longer a drag handle. That is no loss
        // for this window: it is a tray flyout, anchored to the work area corner and
        // repositioned on every open, so a dragged position would not survive
        // anyway.
        //
        // Belt and braces for any caption the framework still decides to draw: force
        // its colours to the window's own dark rather than leaving them system.
        // No SystemBackdrop: the Root grid paints its own opaque dark background
        // (see AppFlyout.xaml). An acrylic backdrop follows the system theme, so on
        // a light-mode desktop it renders light wherever content does not cover it.

        // Mark the window dark so nothing DWM still draws for it (drop shadow,
        // corner antialiasing) is derived from a light system theme. Pinned on
        // regardless of the user's theme choice, matching the web content inside.
        int dark = 1;
        DwmSetWindowAttribute(_hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));

        // Rounded corners ONLY. No manual DWMWA_BORDER_COLOR or DWMWA_CAPTION_COLOR
        // — the same convention the sibling tray app documents. Those attributes
        // colour a frame this window no longer has, and setting them was what
        // produced (and then thickened) the hairline they were meant to remove.
        int round = DWMWCP_ROUND;
        DwmSetWindowAttribute(_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, sizeof(int));

        PinButton.IsChecked = SettingsManager.Current.PinFlyout;
        // Deliberately NOT ThemeManager.ApplySavedTheme: the flyout is pinned dark
        // in XAML to match the web content it frames, and applying the user's
        // light/system choice here would overwrite that and reintroduce light
        // chrome around a dark page. The theme setting governs the settings window.

        _appWindow.Hide();
        Activated += OnActivated;
        Closed += OnClosed;
        Classes.StartupDiagnostics.Mark("Flyout window constructed");

        _ = InitializeWebViewAsync();
    }

    // ── WebView2 ────────────────────────────────────────────────────
    private async Task InitializeWebViewAsync()
    {
        try
        {
            // An explicit, stable user-data folder is what keeps the user signed in
            // across restarts (the session cookie lives there, in the browser's own
            // store) and lets the PWA's service worker cache render offline. Never
            // point this at a temp folder.
            Directory.CreateDirectory(SettingsManager.WebViewDataDirectory);
            // CreateWithOptionsAsync, not CreateAsync: in the WinRT projection the
            // latter is parameterless, so the folder would silently fall back to
            // the default profile beside the exe.
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(
                string.Empty, // empty = use the installed Evergreen runtime
                SettingsManager.WebViewDataDirectory,
                new CoreWebView2EnvironmentOptions());
            await WebView.EnsureCoreWebView2Async(environment);
        }
        catch (Exception ex)
        {
            // Overwhelmingly "the Evergreen runtime isn't installed" — which is a
            // fixable user-facing condition, not a crash.
            Logger.Error(ex, "WebView2 could not be initialized");
            Classes.StartupDiagnostics.Mark($"WebView2 init failed: {ex.Message}");
            ShowError("WebView2 is unavailable", "Persistent needs the Microsoft Edge WebView2 runtime, which is missing or failed to start.");
            return;
        }

        var core = WebView.CoreWebView2;
        core.Settings.IsWebMessageEnabled = true;
        core.Settings.AreDevToolsEnabled = false;
        // Left enabled deliberately: the PWA has text fields, and cut/copy/paste
        // lives on this menu.
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.IsStatusBarEnabled = false;

        core.WebMessageReceived += OnWebMessageReceived;
        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += OnNewWindowRequested;
        core.NavigationCompleted += OnNavigationCompleted;
        core.ProcessFailed += OnProcessFailed;

        _webViewReady = true;
        NavigateToApp();
    }

    private void NavigateToApp()
    {
        if (!_webViewReady) return;
        HideError();
        // The page about to be replaced is the one that was listening; the next one
        // has not subscribed yet and says so itself when it has.
        _pageListening = false;
        try
        {
            WebView.CoreWebView2.Navigate(SettingsManager.Current.EffectiveServerUrl);
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Navigation to the app URL failed");
            ShowError("Can't reach Persistent", SettingsManager.Current.EffectiveServerUrl);
        }
    }

    /// <summary>
    /// Messages from the page. Shape is defined by
    /// `apps/web/src/native/desktopBridge.ts`; anything else is ignored rather than
    /// trusted, since web content is not a privileged caller.
    /// </summary>
    private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        // Only ever act on messages from our own origin.
        if (!IsAppUrl(args.Source)) return;

        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var type)) return;

            switch (type.GetString())
            {
                // Back ran out of hierarchy to walk — the flyout's equivalent of
                // Back leaving the app on Android.
                // A close arriving in the first moments of opening is not the user
                // pressing Back to leave — it is the page reacting to the open
                // itself. That happened for real: a bundle whose host-message
                // handler fell through treated the host's `checkForUpdate` (posted
                // on every resume) as a Back press, and Back from the root screen
                // asks the host to close. The flyout then shut instantly on every
                // open, which also stopped the page ever staying up long enough to
                // fetch the fixed bundle — the app wedged itself. The host refusing
                // an instant close breaks that loop, whatever the page happens to
                // be running.
                case "close":
                    DispatcherQueue.TryEnqueue(() =>
                    {
                        if (Environment.TickCount64 - _shownAtTicks < SettleMs)
                        {
                            Logger.Warn("Ignoring a close request {0}ms after opening - the page may be a stale build",
                                Environment.TickCount64 - _shownAtTicks);
                            return;
                        }
                        HideFlyout("page requested close");
                    });
                    break;

                // The page's host-message listener is attached, so anything held
                // back for it can go now. Posted on every mount, including after a
                // reload, which is why the pending path is cleared as it is sent.
                case "pageReady":
                    DispatcherQueue.TryEnqueue(() =>
                    {
                        _pageListening = true;
                        string? pending = _pendingPath;
                        _pendingPath = null;
                        if (pending != null) PostNavigate(pending);
                    });
                    break;

                // The page's Settings screen showing this app's own settings; see
                // `Classes/Settings/HostSettings.cs`.
                case "getHostSettings":
                    DispatcherQueue.TryEnqueue(() => _ = PostHostSettingsAsync());
                    break;

                case "setHostSettings":
                    if (!root.TryGetProperty("settings", out var patch)) break;
                    // Cloned, because `document` is disposed the moment this handler
                    // returns, long before the apply below gets to read it.
                    var settings = patch.Clone();
                    DispatcherQueue.TryEnqueue(() => _ = ApplyHostSettingsAsync(settings));
                    break;

                // The page asking for the native window, which still owns the server
                // address and About. Hidden afterwards for the same reason the old
                // cog did it: the window would otherwise open behind a flyout that
                // is always on top.
                case "openHostSettings":
                    DispatcherQueue.TryEnqueue(() =>
                    {
                        MainWindow.ShowSettings();
                        HideFlyout("page asked for the settings window");
                    });
                    break;
            }
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Ignoring an unparseable web message");
        }
    }

    /// <summary>
    /// Keep app navigation inside the flyout and send everything else to the real
    /// browser — a tray flyout is the wrong place to land on GitHub or a privacy
    /// policy. Google's sign-in origin is the deliberate exception.
    /// </summary>
    private void OnNavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (IsAppUrl(args.Uri) || IsSignInUrl(args.Uri)) return;
        args.Cancel = true;
        OpenExternally(args.Uri);
    }

    /// <summary>
    /// Popups. Sign in with Google works by opening a popup that posts the
    /// credential back to the opener (the server sets
    /// `Cross-Origin-Opener-Policy: same-origin-allow-popups` for exactly this), so
    /// that one must stay in-app — handing it to the default browser breaks the
    /// hand-back and sign-in silently fails. Everything else opens externally.
    /// </summary>
    private void OnNewWindowRequested(CoreWebView2 sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        if (IsSignInUrl(args.Uri)) return; // leave Handled=false: WebView2 makes the popup itself
        args.Handled = true;
        OpenExternally(args.Uri);
    }

    private void OnNavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.IsSuccess)
        {
            HideError();
            return;
        }

        // A cancelled navigation is our own doing (an external link) — not a failure.
        if (args.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;

        Logger.Warn("Navigation failed: {Status}", args.WebErrorStatus);
        ShowError("Can't reach Persistent", $"{SettingsManager.Current.EffectiveServerUrl} ({args.WebErrorStatus})");
    }

    private void OnProcessFailed(CoreWebView2 sender, CoreWebView2ProcessFailedEventArgs args)
    {
        Logger.Error("WebView2 process failed: {Kind}", args.ProcessFailedKind);
        ShowError("Persistent stopped responding", "The embedded browser process ended. Reload to start it again.");
    }

    private static bool IsAppUrl(string? uri)
    {
        if (string.IsNullOrEmpty(uri)) return false;
        return Uri.TryCreate(uri, UriKind.Absolute, out var parsed)
            && Uri.TryCreate(SettingsManager.Current.EffectiveServerUrl, UriKind.Absolute, out var origin)
            && string.Equals(parsed.Host, origin.Host, StringComparison.OrdinalIgnoreCase)
            && parsed.Port == origin.Port
            && string.Equals(parsed.Scheme, origin.Scheme, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsSignInUrl(string? uri) =>
        !string.IsNullOrEmpty(uri)
        && Uri.TryCreate(uri, UriKind.Absolute, out var parsed)
        && parsed.Host.Equals("accounts.google.com", StringComparison.OrdinalIgnoreCase);

    private static void OpenExternally(string uri)
    {
        try
        {
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not hand {Uri} to the default browser", uri);
        }
    }

    private void ShowError(string title, string detail)
    {
        ErrorTitle.Text = title;
        ErrorDetail.Text = detail;
        ErrorPanel.Visibility = Visibility.Visible;
        WebView.Visibility = Visibility.Collapsed;
    }

    private void HideError()
    {
        ErrorPanel.Visibility = Visibility.Collapsed;
        WebView.Visibility = Visibility.Visible;
    }

    // ── Show / hide ─────────────────────────────────────────────────
    private void ShowNearTray()
    {
        // Anchored on the cursor: the monitor it is on is the one whose tray was
        // just clicked.
        GetCursorPos(out var cursor);
        _appWindow.MoveAndResize(TrayRect(cursor));
        _visible = true;
        _shownAtTicks = Environment.TickCount64;
        SetWebViewIdle(false);
        Activate();
        TakeForeground();
        WebView.Focus(Microsoft.UI.Xaml.FocusState.Programmatic);
        Logger.Info("Flyout shown");
        LogChromeMetrics();
    }

    /// <summary>
    /// Where the flyout goes: the configured size in physical pixels, clamped to the
    /// work area, tucked into the bottom-right corner of the monitor
    /// <paramref name="anchor"/> is on and inset so it clears the taskbar.
    /// </summary>
    private global::Windows.Graphics.RectInt32 TrayRect(POINT anchor)
    {
        var settings = SettingsManager.Current;
        uint dpi = GetDpiForWindow(_hwnd);
        double scale = dpi / 96.0;

        int w = (int)Math.Ceiling(settings.FlyoutWidth * scale);
        int h = (int)Math.Ceiling(settings.FlyoutHeight * scale);

        var mi = new MONITORINFOEX { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<MONITORINFOEX>() };
        int x = anchor.X, y = anchor.Y;
        if (GetMonitorInfo(MonitorFromPoint(anchor, MONITOR_DEFAULTTONEAREST), ref mi))
        {
            int margin = (int)(12 * scale);
            int workWidth = mi.rcWork.Right - mi.rcWork.Left;
            int workHeight = mi.rcWork.Bottom - mi.rcWork.Top;
            // Never taller/wider than the work area, or the flyout runs off-screen
            // on small displays and the PWA's bottom nav becomes unreachable.
            w = Math.Min(w, workWidth - margin * 2);
            h = Math.Min(h, workHeight - margin * 2);
            x = mi.rcWork.Right - w - margin;
            y = mi.rcWork.Bottom - h - margin;
        }

        return new global::Windows.Graphics.RectInt32(x, y, w, h);
    }

    /// <summary>
    /// Re-apply the size while the flyout is open, so changing it from the page
    /// takes effect in front of the user. The control now lives inside the very
    /// window it resizes: without this it would look like it did nothing until the
    /// next open.
    ///
    /// Anchored on the flyout's own centre rather than the cursor, unlike an open:
    /// nothing says the pointer is over this window when the setting changes, and
    /// the flyout should not hop monitors because the mouse was parked elsewhere.
    /// </summary>
    private void ApplyFlyoutSize()
    {
        if (!_visible) return;
        var here = new POINT
        {
            X = _appWindow.Position.X + _appWindow.Size.Width / 2,
            Y = _appWindow.Position.Y + _appWindow.Size.Height / 2
        };
        _appWindow.MoveAndResize(TrayRect(here));
    }

    // ── Host settings, shown on the page's own Settings screen ──────
    /// <summary>
    /// Send the page this app's settings. Posted in reply to its request, after
    /// every write, and whenever the host changes one of them itself, so the
    /// Settings screen can never show a value the host is not using.
    ///
    /// Silent when the WebView isn't up: the page asks again on mount, and a page
    /// that never hears back hides the section rather than showing dead controls.
    /// </summary>
    private async Task PostHostSettingsAsync()
    {
        if (!_webViewReady) return;
        try
        {
            string json = await HostSettings.BuildMessageJsonAsync();
            WebView.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not send the host settings to the page");
        }
    }

    /// <summary>
    /// Apply a settings patch from the page, act on the parts that need this window,
    /// then echo what the host actually holds.
    /// </summary>
    private async Task ApplyHostSettingsAsync(JsonElement patch)
    {
        try
        {
            var applied = await HostSettings.ApplyAsync(patch);
            if (applied.PinChanged) SyncPinState();
            if (applied.FlyoutSizeChanged) ApplyFlyoutSize();
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not apply the host settings the page sent");
        }
        // Echoed even after a failure, so the page shows what the host holds rather
        // than assuming its write landed.
        await PostHostSettingsAsync();
    }

    /// <summary>
    /// Record how much non-client area the window actually has.
    ///
    /// This window is meant to be entirely client area — every pixel painted by the
    /// app. A white strip along the top edge that survived removing the acrylic
    /// backdrop and then the extended title bar means something is still drawing
    /// chrome we do not control, and guessing at which attribute owns it has cost
    /// two rounds. The gap between the outer window rect and the client origin says
    /// it outright: a non-zero `top` is chrome, and its height identifies what.
    /// Logged once per open, to startup.log.
    /// </summary>
    private void LogChromeMetrics()
    {
        try
        {
            if (!GetWindowRect(_hwnd, out var outer)) return;
            if (!GetClientRect(_hwnd, out var client)) return;
            var origin = new POINT { X = 0, Y = 0 };
            if (!ClientToScreen(_hwnd, ref origin)) return;

            int top = origin.Y - outer.Top;
            int left = origin.X - outer.Left;
            int bottom = (outer.Bottom - outer.Top) - (client.Bottom - client.Top) - top;
            Classes.StartupDiagnostics.Mark(
                $"flyout chrome: window {outer.Right - outer.Left}x{outer.Bottom - outer.Top}, " +
                $"client {client.Right - client.Left}x{client.Bottom - client.Top}, " +
                $"non-client top={top} left={left} bottom={bottom}");
        }
        catch (Exception ex)
        {
            Logger.Debug(ex, "Could not measure window chrome");
        }
    }

    /// <summary>
    /// Hide the flyout, recording WHY.
    ///
    /// Logged at Info, not Debug, because `NLog.config` floors the file target at
    /// Info — a Debug line here exists only for an attached debugger, which is no
    /// use on a user's machine. Every caller passes a distinct reason: "it closes
    /// immediately" has several possible causes that look identical from outside
    /// (light dismiss, a second tray click, the page asking), and guessing between
    /// them has already cost two wrong fixes. The log should just say.
    /// </summary>
    private void HideFlyout(string reason)
    {
        _visible = false;
        _hiddenAtTicks = Environment.TickCount64;
        _appWindow.Hide();
        SetWebViewIdle(true);
    }

    /// <summary>
    /// Put the WebView to sleep while the flyout is off-screen, and wake it on show.
    ///
    /// This is only possible because nothing outside the flyout consumes the page.
    /// While the tray icon carried a due-count badge the page's `/ws` socket had to
    /// stay live to feed it, so the most that could be done was stop rendering;
    /// with the badge gone there is no reason to run a browser engine for a window
    /// nobody is looking at.
    ///
    /// Order matters: `TrySuspendAsync` refuses while the controller is visible, so
    /// collapse first. Suspending freezes JavaScript and timers and lets the
    /// renderer's memory be reclaimed; `Resume` restores the page as it was, so the
    /// user still reopens on the screen they left. The socket drops while suspended
    /// and the web client reconnects on resume, which it already handles — that is
    /// the same path as a laptop waking from sleep.
    /// </summary>
    private void SetWebViewIdle(bool idle)
    {
        try
        {
            if (!idle)
            {
                WebView.Visibility = Visibility.Visible;
                if (_webViewReady && _suspended)
                {
                    WebView.CoreWebView2.Resume();
                    _suspended = false;
                }
                NudgeUpdateCheck();
                return;
            }

            WebView.Visibility = Visibility.Collapsed;
            if (!_webViewReady || _suspended) return;
            _ = SuspendWebViewAsync();
        }
        catch (Exception ex)
        {
            // Purely an optimisation — never let it stop the flyout showing.
            Logger.Debug(ex, "Could not change the WebView idle state");
        }
    }

    /// <summary>
    /// Tell the page it has just been resumed, so it can look for a new build.
    ///
    /// This host is the worst case for service-worker updates: the WebView
    /// navigates once at startup and is never rebuilt, so the browser's
    /// on-navigation check happens exactly once in the life of the process, and
    /// suspending freezes the ~24h fallback timer too. Left alone, a tray app
    /// running for a fortnight would still be serving the bundle it started with.
    ///
    /// The page also listens for `visibilitychange`, which collapsing the
    /// controller is supposed to drive — this message exists because that link is
    /// the one part of the chain that cannot be verified outside Windows, and the
    /// page's check is idempotent, so saying it twice costs nothing.
    /// </summary>
    private void NudgeUpdateCheck()
    {
        if (!_webViewReady) return;
        try
        {
            WebView.CoreWebView2.PostWebMessageAsJson("{\"type\":\"checkForUpdate\"}");
        }
        catch (Exception ex)
        {
            // Worst case the page updates on the next restart, as it did before.
            Logger.Debug(ex, "Could not ask the page to check for an update");
        }
    }

    /// <summary>
    /// Suspend once the controller has actually gone invisible. Failure is fine:
    /// the page simply keeps running, which is what it did before.
    /// </summary>
    private async Task SuspendWebViewAsync()
    {
        try
        {
            _suspended = await WebView.CoreWebView2.TrySuspendAsync();
        }
        catch (Exception ex)
        {
            Logger.Debug(ex, "Could not suspend the WebView");
            _suspended = false;
        }
    }

    /// <summary>
    /// Light dismiss, done by hand.
    ///
    /// The obvious version — hide on any Deactivated — is wrong here: focus moving
    /// into the hosted WebView2 can surface as a top-level deactivation, which would
    /// close the flyout the instant the user clicked into the page. So re-check on
    /// the next dispatcher turn (by which time the foreground window has actually
    /// settled) and stay open if the foreground window is still ours.
    /// </summary>
    /// <summary>
    /// Light dismiss: close when focus genuinely leaves the flyout.
    ///
    /// Two things stop this from closing a flyout the user is still opening. The
    /// re-check on the next dispatcher turn is for focus moving *into* the hosted
    /// WebView2, which can surface as a top-level deactivation — by then the
    /// foreground window has settled and is still us. <see cref="SettleMs"/> is for
    /// the opening itself: showing, activating and taking the foreground is not
    /// atomic, and a Deactivated arriving mid-sequence used to close the window
    /// immediately, every time.
    /// </summary>
    private void OnActivated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState != WindowActivationState.Deactivated) return;
        if (SettingsManager.Current.PinFlyout) return;
        if (!_visible) return;
        if (Environment.TickCount64 - _shownAtTicks < SettleMs) return;

        DispatcherQueue.TryEnqueue(() =>
        {
            if (!_visible || SettingsManager.Current.PinFlyout) return;
            if (Environment.TickCount64 - _shownAtTicks < SettleMs) return;
            IntPtr foreground = GetForegroundWindow();
            if (foreground != IntPtr.Zero && GetAncestor(foreground, GA_ROOT) == _hwnd) return;
            // Logged because a flyout that closes when it shouldn't is invisible in
            // every other way: this names the window that took the foreground, which
            // is the only thing that distinguishes "the user clicked away" from
            // "we never had focus in the first place".
            Logger.Info("Light dismiss: foreground={0:X} root={1:X} self={2:X}",
                foreground.ToInt64(),
                foreground == IntPtr.Zero ? 0 : GetAncestor(foreground, GA_ROOT).ToInt64(),
                _hwnd.ToInt64());
            HideFlyout("light dismiss");
        });
    }

    /// <summary>
    /// Actually get the foreground, which a plain <c>SetForegroundWindow</c> often
    /// cannot from a tray app.
    ///
    /// Windows only lets the foreground process (or the one that owns the latest
    /// input) set it; a tray click leaves the shell foreground, so the call returns
    /// false and the flyout comes up unfocused — which the light-dismiss check then
    /// reads as "focus is elsewhere" and closes. Attaching to the foreground
    /// thread's input queue for the duration lifts the restriction.
    /// </summary>
    private void TakeForeground()
    {
        try
        {
            if (SetForegroundWindow(_hwnd)) return;

            IntPtr foreground = GetForegroundWindow();
            uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out _);
            uint self = GetCurrentThreadId();
            if (foregroundThread == 0 || foregroundThread == self)
            {
                Logger.Debug("Could not take the foreground and have no thread to attach to");
                return;
            }

            if (!AttachThreadInput(foregroundThread, self, true))
            {
                Logger.Debug("AttachThreadInput refused; the flyout may open without focus");
                return;
            }
            try
            {
                BringWindowToTop(_hwnd);
                if (!SetForegroundWindow(_hwnd)) Logger.Debug("SetForegroundWindow still refused after attaching");
            }
            finally
            {
                AttachThreadInput(foregroundThread, self, false);
            }
        }
        catch (Exception ex)
        {
            // Never let focus plumbing stop the window appearing.
            Logger.Warn(ex, "Taking the foreground failed");
        }
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        if (_instance == this) _instance = null;
    }

    // ── Chrome handlers ─────────────────────────────────────────────
    private void PinButton_Click(object sender, RoutedEventArgs e)
    {
        SettingsManager.Current.PinFlyout = PinButton.IsChecked == true;
        SettingsManager.SaveSettings();
        // The page's Settings screen offers the same pin, so tell it what happened.
        _ = PostHostSettingsAsync();
    }

    private void BrowserButton_Click(object sender, RoutedEventArgs e)
    {
        MainWindow.OpenInBrowser();
        HideFlyout("opened in browser");
    }

    /// <summary>
    /// The error panel's way into the native settings window. Same sequence as the
    /// page's own "More Windows app settings" button, and the only one available
    /// when the page is the thing that is broken.
    /// </summary>
    private void ErrorSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        MainWindow.ShowSettings();
        HideFlyout("error panel asked for the settings window");
    }

    private void RetryButton_Click(object sender, RoutedEventArgs e) => NavigateToApp();

    /// <summary>
    /// Ask the page to go back one level in its own hierarchy.
    ///
    /// Deliberately a message rather than `CoreWebView2.GoBack()`: browser history
    /// is the trail of every hop the user made, which is exactly the model the app
    /// rejected on Android (see `native/useNativeBack.ts`). The page walks its
    /// screen hierarchy instead and tells us if it ran out, at which point it asks
    /// for the flyout to close.
    /// </summary>
    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (!_webViewReady) return;
        try
        {
            WebView.CoreWebView2.PostWebMessageAsJson("{\"type\":\"back\"}");
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not post the back message");
        }
    }
}
