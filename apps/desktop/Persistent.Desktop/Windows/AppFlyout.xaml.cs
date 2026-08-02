using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Persistent.Desktop.Classes.Settings;
using Persistent.Desktop.Services;
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
/// open. Two reasons, both load-bearing:
///
/// 1. The page owns the live `/ws` socket that feeds the tray badge
///    (<see cref="TrayState"/>). Tearing the WebView down between opens would mean
///    the badge only worked while the flyout was on screen, which is backwards.
/// 2. A cold WebView2 plus a page load is a visible pause on every tray click.
///
/// Because the hosted page is the same bundle the web and Android clients run, the
/// user gets sign-in (including passkeys via Windows Hello, which the Android
/// WebView cannot do), Done/Snooze/De-escalate and the editor with no native
/// reimplementation — and no way for this surface to drift from
/// docs/notification-behavior.md. What it deliberately does NOT provide is the
/// persistence guarantee: no toasts, no alarm audio. See
/// docs/desktop-architecture.md.
/// </summary>
public sealed partial class AppFlyout : Window
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private static AppFlyout? _instance;

    private readonly IntPtr _hwnd;
    private readonly AppWindow _appWindow;
    private bool _webViewReady;
    private bool _visible;

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
        if (_instance is { _visible: true }) _instance.HideFlyout();
    }

    public static void Toggle()
    {
        EnsureCreated();
        if (_instance == null) return;
        if (_instance._visible) _instance.HideFlyout();
        else _instance.ShowNearTray();
    }

    public static void Reload() => _instance?.NavigateToApp();

    /// <summary>Re-read the pin setting after it was changed from the settings window.</summary>
    public static void SyncPinState()
    {
        var instance = _instance;
        if (instance == null) return;
        instance.DispatcherQueue.TryEnqueue(() =>
            instance.PinButton.IsChecked = SettingsManager.Current.PinFlyout);
    }

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

    private AppFlyout()
    {
        InitializeComponent();

        _hwnd = WindowNative.GetWindowHandle(this);
        _appWindow = AppWindow.GetFromWindowId(Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_hwnd));
        _appWindow.IsShownInSwitchers = false;

        // A plain overlapped presenter with the chrome stripped, rather than
        // OverlappedPresenter.CreateForContextMenu(): this window hosts a full web
        // app with text entry, so it needs ordinary activation and keyboard focus.
        // Light dismiss is implemented below instead of inherited.
        var presenter = OverlappedPresenter.Create();
        presenter.SetBorderAndTitleBar(false, false);
        presenter.IsAlwaysOnTop = true;
        presenter.IsMaximizable = false;
        presenter.IsMinimizable = false;
        presenter.IsResizable = true;
        _appWindow.SetPresenter(presenter);

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        SystemBackdrop = new Microsoft.UI.Xaml.Media.DesktopAcrylicBackdrop();

        int round = DWMWCP_ROUND;
        DwmSetWindowAttribute(_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, sizeof(int));

        if (File.Exists(App.IconImagePath))
        {
            try { Icon.Source = new BitmapImage(new Uri(App.IconImagePath)); } catch { /* cosmetic */ }
        }

        PinButton.IsChecked = SettingsManager.Current.PinFlyout;
        Classes.ThemeManager.ApplySavedTheme(this);

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
    /// The page reporting how many reminders are nagging. Shape is defined by
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
            if (!root.TryGetProperty("type", out var type) || type.GetString() != "badge") return;

            int count = root.TryGetProperty("count", out var c) && c.TryGetInt32(out int parsed) ? parsed : 0;
            bool escalated = root.TryGetProperty("escalated", out var e) && e.ValueKind == JsonValueKind.True;
            TrayState.Report(count, escalated);
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
        TrayState.Reset();
        ShowError("Can't reach Persistent", $"{SettingsManager.Current.EffectiveServerUrl} ({args.WebErrorStatus})");
    }

    private void OnProcessFailed(CoreWebView2 sender, CoreWebView2ProcessFailedEventArgs args)
    {
        Logger.Error("WebView2 process failed: {Kind}", args.ProcessFailedKind);
        TrayState.Reset();
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
        var settings = SettingsManager.Current;
        uint dpi = GetDpiForWindow(_hwnd);
        double scale = dpi / 96.0;

        int w = (int)Math.Ceiling(settings.FlyoutWidth * scale);
        int h = (int)Math.Ceiling(settings.FlyoutHeight * scale);

        // Anchor to the work area of the monitor the cursor is on — i.e. the one
        // whose tray was just clicked — and inset so it clears the taskbar.
        GetCursorPos(out var pt);
        var mi = new MONITORINFOEX { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<MONITORINFOEX>() };
        int x = pt.X, y = pt.Y;
        if (GetMonitorInfo(MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST), ref mi))
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

        _appWindow.MoveAndResize(new global::Windows.Graphics.RectInt32(x, y, w, h));
        _visible = true;
        Activate();
        SetForegroundWindow(_hwnd);
        WebView.Focus(Microsoft.UI.Xaml.FocusState.Programmatic);
    }

    private void HideFlyout()
    {
        PersistSize();
        _visible = false;
        _appWindow.Hide();
    }

    /// <summary>Remember a resize so the next open is the size the user left it.</summary>
    private void PersistSize()
    {
        if (!_visible) return;
        uint dpi = GetDpiForWindow(_hwnd);
        double scale = dpi / 96.0;
        if (scale <= 0) return;

        int width = (int)Math.Round(_appWindow.Size.Width / scale);
        int height = (int)Math.Round(_appWindow.Size.Height / scale);
        var settings = SettingsManager.Current;
        if (width == settings.FlyoutWidth && height == settings.FlyoutHeight) return;
        if (width < 320 || height < 400) return;

        settings.FlyoutWidth = width;
        settings.FlyoutHeight = height;
        SettingsManager.SaveSettings();
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
    private void OnActivated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState != WindowActivationState.Deactivated) return;
        if (SettingsManager.Current.PinFlyout) return;
        if (!_visible) return;

        DispatcherQueue.TryEnqueue(() =>
        {
            if (!_visible || SettingsManager.Current.PinFlyout) return;
            IntPtr foreground = GetForegroundWindow();
            if (foreground != IntPtr.Zero && GetAncestor(foreground, GA_ROOT) == _hwnd) return;
            HideFlyout();
        });
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        PersistSize();
        if (_instance == this) _instance = null;
    }

    // ── Chrome handlers ─────────────────────────────────────────────
    private void PinButton_Click(object sender, RoutedEventArgs e)
    {
        SettingsManager.Current.PinFlyout = PinButton.IsChecked == true;
        SettingsManager.SaveSettings();
    }

    private void BrowserButton_Click(object sender, RoutedEventArgs e)
    {
        MainWindow.OpenInBrowser();
        HideFlyout();
    }

    private void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        MainWindow.ShowSettings();
        HideFlyout();
    }

    private void RetryButton_Click(object sender, RoutedEventArgs e) => NavigateToApp();
}
